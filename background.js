// Service worker for background tasks

// Omnibox suggestions cache
let searchCache = new Map();
let lastSearch = '';

chrome.runtime.onInstalled.addListener(() => {
  console.log('RepoVault 2.0 installed');
});

// ========== OMNIBOX INTEGRATION ==========
chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  try {
    const result = await chrome.storage.sync.get('bookmarks');
    const bookmarks = result.bookmarks || [];
    
    if (!text) {
      suggest([]);
      return;
    }
    
    const searchTerm = text.toLowerCase();
    const matches = bookmarks
      .filter(b => 
        b.repo.toLowerCase().includes(searchTerm) ||
        b.owner.toLowerCase().includes(searchTerm) ||
        b.category.toLowerCase().includes(searchTerm) ||
        (b.description && b.description.toLowerCase().includes(searchTerm))
      )
      .slice(0, 6) // Limit to 6 suggestions
      .map(b => ({
        content: b.url,
        description: `<match>${b.owner}/${b.repo}</match> - ${escapeXml(b.category)} ${getHealthIcon(b.healthStatus)} ${b.stars ? '⭐ ' + b.stars : ''}`
      }));
    
    // Add default suggestion
    chrome.omnibox.setDefaultSuggestion({
      description: matches.length > 0 
        ? `Found ${matches.length} repo${matches.length > 1 ? 's' : ''} in Vault`
        : 'No matching repos found in Vault'
    });
    
    suggest(matches);
  } catch (err) {
    console.error('Omnibox error:', err);
    suggest([]);
  }
});

chrome.omnibox.onInputEntered.addListener((url, disposition) => {
  if (!url.startsWith('http')) return;
  
  switch (disposition) {
    case 'currentTab':
      chrome.tabs.update({ url });
      break;
    case 'newForegroundTab':
      chrome.tabs.create({ url });
      break;
    case 'newBackgroundTab':
      chrome.tabs.create({ url, active: false });
      break;
  }
});

// ========== MESSAGE HANDLING ==========
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getBookmarkCount') {
    chrome.storage.sync.get('bookmarks', (result) => {
      const count = result.bookmarks ? result.bookmarks.length : 0;
      sendResponse({ count });
    });
    return true;
  }
  
  if (request.action === 'checkHealth') {
    checkRepoHealth(request.owner, request.repo).then(sendResponse);
    return true;
  }
  
  if (request.action === 'batchHealthCheck') {
    batchHealthCheck(request.repos).then(sendResponse);
    return true;
  }
});

// ========== HEALTH CHECK FUNCTIONS ==========
async function checkRepoHealth(owner, repo) {
  try {
    // Check cache first
    const cacheKey = `${owner}/${repo}`;
    const cached = await chrome.storage.local.get(`health_${cacheKey}`);
    if (cached[`health_${cacheKey}`]) {
      const cache = cached[`health_${cacheKey}`];
      if (Date.now() - cache.timestamp < 3600000) { // 1 hour cache
        return cache.data;
      }
    }
    
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'RepoVault-Extension'
      }
    });
    
    if (!response.ok) {
      if (response.status === 404) return { status: 'not_found', error: 'Repository not found' };
      if (response.status === 403) return { status: 'rate_limited', error: 'API rate limit exceeded' };
      throw new Error('Failed to fetch');
    }
    
    const data = await response.json();
    
    const lastPush = new Date(data.pushed_at);
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    
    let healthStatus = 'healthy';
    let warnings = [];
    
    if (data.archived) {
      healthStatus = 'archived';
      warnings.push('Repository is archived');
    } else if (lastPush < twoYearsAgo) {
      healthStatus = 'stale';
      warnings.push('No updates for 2+ years');
    }
    
    const result = {
      status: healthStatus,
      archived: data.archived,
      lastPush: data.pushed_at,
      stars: data.stargazers_count,
      openIssues: data.open_issues_count,
      warnings,
      timestamp: Date.now()
    };
    
    // Cache result
    await chrome.storage.local.set({
      [`health_${cacheKey}`]: {
        data: result,
        timestamp: Date.now()
      }
    });
    
    return result;
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

async function batchHealthCheck(repos) {
  // Rate limit aware batch processing
  const results = {};
  const BATCH_SIZE = 5; // Process 5 at a time to respect rate limits
  
  for (let i = 0; i < repos.length; i += BATCH_SIZE) {
    const batch = repos.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (repo) => {
      const health = await checkRepoHealth(repo.owner, repo.repo);
      results[`${repo.owner}/${repo.repo}`] = health;
    });
    
    await Promise.all(promises);
    
    // Small delay between batches
    if (i + BATCH_SIZE < repos.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return results;
}

// ========== STORAGE MIGRATION ==========
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'update') {
    // Migrate from local to sync storage
    try {
      const local = await chrome.storage.local.get('bookmarks');
      if (local.bookmarks && local.bookmarks.length > 0) {
        const sync = await chrome.storage.sync.get('bookmarks');
        if (!sync.bookmarks || sync.bookmarks.length === 0) {
          await chrome.storage.sync.set({ bookmarks: local.bookmarks });
          console.log('Migrated bookmarks to sync storage');
        }
      }
    } catch (err) {
      console.error('Migration failed:', err);
    }
  }
});

// ========== UTILITIES ==========
function escapeXml(str) {
  if (!str) return '';
  return str.replace(/[<>&"]/g, c => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;'
  })[c]);
}

function getHealthIcon(status) {
  const icons = {
    'healthy': '',
    'stale': '⚠️ ',
    'archived': '📦 ',
    'not_found': '❌ ',
    'rate_limited': '⏳ '
  };
  return icons[status] || '';
}

// Periodic health check for all bookmarks (runs once per day)
chrome.alarms?.create('healthCheck', { periodInMinutes: 1440 });

chrome.alarms?.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'healthCheck') {
    const result = await chrome.storage.sync.get('bookmarks');
    const bookmarks = result.bookmarks || [];
    
    // Only check first 10 bookmarks to avoid rate limits
    const toCheck = bookmarks.slice(0, 10);
    await batchHealthCheck(toCheck.map(b => ({ owner: b.owner, repo: b.repo })));
  }
});
