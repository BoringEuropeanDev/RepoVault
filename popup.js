// State management
let bookmarks = [];
let currentMetadata = null;
let healthCache = new Map();

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  await loadBookmarks();
  updateStats();
  setupTabs();
  setupEventListeners();
  renderBookmarks();
  updateCategoryFilter();
  updateStorageInfo();
  checkHealthIssues();
});

// Load bookmarks from Chrome sync storage
async function loadBookmarks() {
  try {
    const result = await chrome.storage.sync.get('bookmarks');
    bookmarks = result.bookmarks || [];
  } catch (err) {
    console.error('Failed to load bookmarks:', err);
    bookmarks = [];
  }
}

// Save bookmarks to Chrome sync storage with quota handling
async function saveBookmarks() {
  try {
    // Check size before saving
    const data = JSON.stringify(bookmarks);
    const size = new Blob([data]).size;
    
    if (size > 102400) {
      showStatus('Storage limit reached! Delete some repos.', 'error');
      return false;
    }
    
    await chrome.storage.sync.set({ bookmarks });
    updateStorageInfo();
    return true;
  } catch (err) {
    if (err.message.includes('QUOTA_BYTES_PER_ITEM')) {
      showStatus('Item too large. Reduce notes length.', 'error');
    } else {
      showStatus('Failed to save. Try again.', 'error');
    }
    return false;
  }
}

// ========== TAB NAVIGATION ==========
function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      btn.classList.add('active');
      document.getElementById(tabName).classList.add('active');
    });
  });
}

// ========== EVENT LISTENERS ==========
function setupEventListeners() {
  // Add repo
  document.getElementById('saveBtn').addEventListener('click', addRepo);
  document.getElementById('fetchMetadata').addEventListener('click', previewMetadata);
  
  // Search & Filter
  document.getElementById('searchInput').addEventListener('input', debounce(renderBookmarks, 300));
  document.getElementById('categoryFilter').addEventListener('change', renderBookmarks);
  document.getElementById('sortBy').addEventListener('change', renderBookmarks);
  document.getElementById('refreshHealth').addEventListener('click', refreshAllHealth);
  
  // Settings
  document.getElementById('exportBtn').addEventListener('click', exportBookmarks);
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', importBookmarks);
  document.getElementById('clearBtn').addEventListener('click', clearAll);
  
  // Health stat click
  document.getElementById('healthStat').addEventListener('click', filterByHealthIssues);
}

// ========== METADATA FETCHING ==========
async function previewMetadata() {
  const url = document.getElementById('repoUrl').value.trim();
  
  if (!url) {
    showStatus('Enter a repo URL first', 'error');
    return;
  }
  
  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    showStatus('Invalid GitHub URL', 'error');
    return;
  }
  
  showStatus('Fetching metadata...', 'info');
  
  try {
    const metadata = await fetchRepoMetadata(parsed.owner, parsed.repo);
    currentMetadata = metadata;
    
    // Update preview UI
    document.getElementById('metadataPreview').style.display = 'block';
    document.getElementById('previewLanguage').textContent = metadata.language || 'Unknown';
    document.getElementById('previewStars').textContent = `⭐ ${metadata.stars?.toLocaleString() || 0}`;
    document.getElementById('previewDesc').textContent = metadata.description || 'No description available';
    
    const topicsContainer = document.getElementById('previewTopics');
    topicsContainer.innerHTML = '';
    if (metadata.topics && metadata.topics.length > 0) {
      metadata.topics.slice(0, 5).forEach(topic => {
        const span = document.createElement('span');
        span.className = 'preview-topic';
        span.textContent = topic;
        topicsContainer.appendChild(span);
      });
    }
    
    // Auto-fill category if empty
    const categoryInput = document.getElementById('repoCategory');
    if (!categoryInput.value && metadata.suggestedCategory) {
      categoryInput.value = metadata.suggestedCategory;
    }
    
    showStatus('Metadata loaded! Click Save to store', 'success');
  } catch (err) {
    showStatus('Failed to fetch metadata. Proceed with manual entry.', 'error');
  }
}

async function fetchRepoMetadata(owner, repo) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'RepoVault-Extension'
    }
  });
  
  if (!response.ok) {
    if (response.status === 403) throw new Error('Rate limited');
    throw new Error('Failed to fetch');
  }
  
  const data = await response.json();
  
  // Calculate health
  const lastPush = new Date(data.pushed_at);
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  
  let healthStatus = 'healthy';
  if (data.archived) healthStatus = 'archived';
  else if (lastPush < twoYearsAgo) healthStatus = 'stale';
  
  return {
    description: data.description,
    stars: data.stargazers_count,
    language: data.language,
    lastCommit: data.pushed_at,
    topics: data.topics || [],
    archived: data.archived,
    healthStatus,
    suggestedCategory: categorizeRepo(data.topics, data.language)
  };
}

function categorizeRepo(topics, language) {
  const topicMap = {
    'react': 'Frontend', 'vue': 'Frontend', 'angular': 'Frontend', 'svelte': 'Frontend',
    'frontend': 'Frontend', 'ui': 'Frontend', 'component': 'Frontend',
    'node': 'Backend', 'nodejs': 'Backend', 'express': 'Backend',
    'django': 'Backend', 'flask': 'Backend', 'backend': 'Backend',
    'api': 'Backend', 'server': 'Backend',
    'machine-learning': 'ML/AI', 'deep-learning': 'ML/AI', 'ai': 'ML/AI',
    'tensorflow': 'ML/AI', 'pytorch': 'ML/AI', 'nlp': 'ML/AI',
    'devops': 'DevOps', 'docker': 'DevOps', 'kubernetes': 'DevOps',
    'mobile': 'Mobile', 'android': 'Mobile', 'ios': 'Mobile',
    'react-native': 'Mobile', 'flutter': 'Mobile',
    'tool': 'Tools', 'cli': 'Tools', 'utility': 'Tools'
  };
  
  for (const topic of topics) {
    if (topicMap[topic.toLowerCase()]) return topicMap[topic.toLowerCase()];
  }
  
  const langMap = {
    'JavaScript': 'Frontend', 'TypeScript': 'Frontend', 'HTML': 'Frontend',
    'Python': 'Backend', 'Go': 'Backend', 'Rust': 'Backend',
    'Swift': 'Mobile', 'Kotlin': 'Mobile'
  };
  
  return langMap[language] || 'uncategorized';
}

// ========== ADD REPO ==========
async function addRepo() {
  const url = document.getElementById('repoUrl').value.trim();
  let category = document.getElementById('repoCategory').value.trim();
  const notes = document.getElementById('repoNotes').value.trim();

  if (!url) {
    showStatus('Enter a repo URL', 'error');
    return;
  }

  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    showStatus('Invalid GitHub URL format', 'error');
    return;
  }

  // Check duplicates
  if (bookmarks.some(b => b.owner === parsed.owner && b.repo === parsed.repo)) {
    showStatus('Already in your vault!', 'error');
    return;
  }

  // Use metadata if available
  let metadata = currentMetadata;
  if (!metadata) {
    try {
      metadata = await fetchRepoMetadata(parsed.owner, parsed.repo);
    } catch (err) {
      metadata = {
        suggestedCategory: 'uncategorized',
        healthStatus: 'unknown'
      };
    }
  }

  const bookmark = {
    id: Date.now(),
    owner: parsed.owner,
    repo: parsed.repo,
    category: category || metadata.suggestedCategory || 'uncategorized',
    notes,
    url: `https://github.com/${parsed.owner}/${parsed.repo}`,
    description: metadata.description || '',
    stars: metadata.stars || 0,
    language: metadata.language || 'Unknown',
    lastCommit: metadata.lastCommit || null,
    topics: metadata.topics || [],
    archived: metadata.archived || false,
    healthStatus: metadata.healthStatus || 'unknown',
    savedAt: new Date().toISOString()
  };

  bookmarks.push(bookmark);
  
  if (await saveBookmarks()) {
    // Clear form
    document.getElementById('repoUrl').value = '';
    document.getElementById('repoCategory').value = '';
    document.getElementById('repoNotes').value = '';
    document.getElementById('metadataPreview').style.display = 'none';
    currentMetadata = null;
    
    showStatus('Saved to vault!', 'success');
    updateStats();
    updateCategoryFilter();
    renderBookmarks();
    checkHealthIssues();
  }
}

function parseGitHubUrl(url) {
  // Handle full URLs or owner/repo format
  let cleanUrl = url.trim();
  
  // Remove protocol and github.com
  cleanUrl = cleanUrl.replace(/^https?:\/\//, '');
  cleanUrl = cleanUrl.replace(/^github\.com\//, '');
  
  const parts = cleanUrl.split('/').filter(p => p);
  if (parts.length < 2) return null;
  
  return {
    owner: parts[0],
    repo: parts[1].replace(/\/$/, '') // Remove trailing slash
  };
}

// ========== RENDER BOOKMARKS ==========
function renderBookmarks() {
  const searchTerm = document.getElementById('searchInput').value.toLowerCase();
  const selectedCategory = document.getElementById('categoryFilter').value;
  const sortBy = document.getElementById('sortBy').value;
  const list = document.getElementById('bookmarksList');
  const empty = document.getElementById('emptyState');

  let filtered = bookmarks.filter(b => {
    const matchesSearch = 
      b.repo.toLowerCase().includes(searchTerm) ||
      b.owner.toLowerCase().includes(searchTerm) ||
      b.notes.toLowerCase().includes(searchTerm) ||
      (b.description && b.description.toLowerCase().includes(searchTerm));
    
    const matchesCategory = !selectedCategory || b.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  // Sort
  filtered.sort((a, b) => {
    switch(sortBy) {
      case 'newest': return b.id - a.id;
      case 'stars': return (b.stars || 0) - (a.stars || 0);
      case 'name': return `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`);
      case 'health':
        const healthOrder = { archived: 0, stale: 1, unknown: 2, healthy: 3 };
        return (healthOrder[a.healthStatus] || 2) - (healthOrder[b.healthStatus] || 2);
      default: return b.id - a.id;
    }
  });

  if (filtered.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  
  list.innerHTML = filtered.map(b => {
    const healthClass = `health-${b.healthStatus || 'unknown'}`;
    const healthBadge = b.healthStatus && b.healthStatus !== 'healthy' && b.healthStatus !== 'unknown' 
      ? `<span class="health-badge ${b.healthStatus}">${b.healthStatus}</span>` 
      : '';
    
    const lastCommit = b.lastCommit 
      ? new Date(b.lastCommit).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      : 'Unknown';
    
    const timeAgo = b.lastCommit ? getTimeAgo(new Date(b.lastCommit)) : '';
    
    return `
      <div class="bookmark-item ${healthClass}" data-id="${b.id}">
        <div class="bookmark-header">
          <div class="bookmark-title">
            <a href="${b.url}" target="_blank" title="Open in new tab">
              ${b.owner}/<strong>${b.repo}</strong>
            </a>
          </div>
          ${healthBadge}
        </div>
        
        <div class="bookmark-meta-row">
          ${b.language ? `<span class="meta-item language">${b.language}</span>` : ''}
          ${b.stars ? `<span class="meta-item stars">⭐ ${b.stars.toLocaleString()}</span>` : ''}
          <span class="meta-item" title="Last updated: ${lastCommit}">🕒 ${timeAgo || lastCommit}</span>
        </div>
        
        <span class="bookmark-category">${b.category}</span>
        
        ${b.description ? `<div class="bookmark-description">${escapeHtml(b.description)}</div>` : ''}
        ${b.notes ? `<div class="bookmark-notes">${escapeHtml(b.notes)}</div>` : ''}
        
        <div class="bookmark-actions">
          <button onclick="copyLink('${b.url}')" title="Copy URL">📋 Copy</button>
          <button onclick="openRepo('${b.url}')" title="Open repository">🔗 Open</button>
          <button onclick="deleteBookmark(${b.id})" class="delete" title="Remove from vault">🗑️ Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  const intervals = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400
  };
  
  for (const [unit, secondsInUnit] of Object.entries(intervals)) {
    const interval = Math.floor(seconds / secondsInUnit);
    if (interval >= 1) {
      return `${interval}${unit[0]}`; // 2y, 5m, 3w, 4d
    }
  }
  return 'recent';
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========== BOOKMARK ACTIONS ==========
function copyLink(url) {
  navigator.clipboard.writeText(url);
  showStatus('Link copied!', 'success');
}

function openRepo(url) {
  chrome.tabs.create({ url });
}

async function deleteBookmark(id) {
  if (!confirm('Remove this repository from your vault?')) return;
  
  bookmarks = bookmarks.filter(b => b.id !== id);
  await saveBookmarks();
  renderBookmarks();
  updateCategoryFilter();
  updateStats();
  checkHealthIssues();
}

// ========== CATEGORY FILTER ==========
function updateCategoryFilter() {
  const select = document.getElementById('categoryFilter');
  const categories = [...new Set(bookmarks.map(b => b.category))].sort();
  const current = select.value;
  
  select.innerHTML = '<option value="">All Categories</option>';
  
  categories.forEach(cat => {
    const option = document.createElement('option');
    option.value = cat;
    option.textContent = cat;
    select.appendChild(option);
  });
  
  select.value = current;
}

// ========== HEALTH CHECK ==========
async function checkHealthIssues() {
  const stale = bookmarks.filter(b => b.healthStatus === 'stale').length;
  const archived = bookmarks.filter(b => b.healthStatus === 'archived').length;
  const total = stale + archived;
  
  const healthStat = document.getElementById('healthStat');
  document.getElementById('healthIssues').textContent = total;
  
  if (total > 0) {
    healthStat.classList.add('has-issues');
    healthStat.title = `${stale} stale, ${archived} archived`;
  } else {
    healthStat.classList.remove('has-issues');
    healthStat.title = 'All repositories healthy';
  }
}

function filterByHealthIssues() {
  // Filter to show only stale and archived
  const select = document.getElementById('categoryFilter');
  select.value = '';
  document.getElementById('searchInput').value = '';
  document.getElementById('sortBy').value = 'health';
  renderBookmarks();
  
  // Switch to bookmarks tab
  document.querySelector('[data-tab="bookmarks"]').click();
}

async function refreshAllHealth() {
  const btn = document.getElementById('refreshHealth');
  btn.style.animation = 'spin 1s linear infinite';
  
  showStatus('Checking repository health...', 'info');
  
  try {
    // Check first 10 repos to respect rate limits
    const toCheck = bookmarks.slice(0, 10);
    
    for (const bookmark of toCheck) {
      try {
        const response = await fetch(`https://api.github.com/repos/${bookmark.owner}/${bookmark.repo}`, {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'RepoVault-Extension'
          }
        });
        
        if (!response.ok) continue;
        
        const data = await response.json();
        const lastPush = new Date(data.pushed_at);
        const twoYearsAgo = new Date();
        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
        
        let healthStatus = 'healthy';
        if (data.archived) healthStatus = 'archived';
        else if (lastPush < twoYearsAgo) healthStatus = 'stale';
        
        // Update bookmark
        bookmark.healthStatus = healthStatus;
        bookmark.archived = data.archived;
        bookmark.stars = data.stargazers_count;
        bookmark.lastCommit = data.pushed_at;
      } catch (err) {
        console.warn(`Failed to check ${bookmark.owner}/${bookmark.repo}`);
      }
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    await saveBookmarks();
    renderBookmarks();
    checkHealthIssues();
    showStatus('Health check complete!', 'success');
  } catch (err) {
    showStatus('Health check failed', 'error');
  } finally {
    btn.style.animation = '';
  }
}

// ========== STATS ==========
function updateStats() {
  document.getElementById('totalBookmarks').textContent = bookmarks.length;
  
  const categories = new Set(bookmarks.map(b => b.category));
  document.getElementById('totalCategories').textContent = categories.size;
}

function updateStorageInfo() {
  const data = JSON.stringify(bookmarks);
  const size = new Blob([data]).size;
  const maxSize = 102400; // 100KB
  const percentage = (size / maxSize) * 100;
  
  const usedBar = document.getElementById('storageUsed');
  const storageText = document.getElementById('storageText');
  
  usedBar.style.width = `${Math.min(percentage, 100)}%`;
  
  if (percentage > 90) {
    usedBar.className = 'storage-used danger';
  } else if (percentage > 70) {
    usedBar.className = 'storage-used warning';
  } else {
    usedBar.className = 'storage-used';
  }
  
  const kb = (size / 1024).toFixed(1);
  storageText.textContent = `${kb} KB / 100 KB used (${Math.round(percentage)}%)`;
}

// ========== EXPORT / IMPORT ==========
function exportBookmarks() {
  const data = JSON.stringify(bookmarks, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `repovault-backup-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showStatus('Exported successfully!', 'success');
}

async function importBookmarks(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const imported = JSON.parse(event.target.result);
      
      if (!Array.isArray(imported)) {
        throw new Error('Invalid format: expected array');
      }
      
      // Validate and merge
      const required = ['owner', 'repo', 'url'];
      const valid = imported.filter(item => 
        required.every(field => item[field])
      );
      
      const existingUrls = new Set(bookmarks.map(b => b.url));
      const newBookmarks = valid.filter(b => !existingUrls.has(b.url));
      
      // Check storage limit
      const combined = [...bookmarks, ...newBookmarks];
      const size = new Blob([JSON.stringify(combined)]).size;
      
      if (size > 102400) {
        showStatus('Import too large for sync storage', 'error');
        return;
      }
      
      bookmarks = combined;
      await saveBookmarks();
      
      renderBookmarks();
      updateCategoryFilter();
      updateStats();
      checkHealthIssues();
      show
