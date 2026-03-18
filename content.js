// Content script for native GitHub UI integration
(function() {
  'use strict';
  
  // Prevent duplicate injection
  if (window.__repovaultInjected) return;
  window.__repovaultInjected = true;

  const SELECTORS = {
    repoHeader: 'h1.public, h1.private, [data-testid="repo-header"]',
    actionsBar: '.pagehead-actions, .BorderGrid-cell, [data-testid="star-button"]',
    starButton: '.star-button, [aria-label*="Star"], [data-testid="star-button"]'
  };

  let observer = null;
  let retryCount = 0;
  const MAX_RETRIES = 10;

  function init() {
    if (isRepoPage()) {
      injectVaultButton();
      startObserver();
    }
  }

  function isRepoPage() {
    const path = window.location.pathname;
    const parts = path.split('/').filter(p => p);
    // Match: /owner/repo or /owner/repo/...
    return parts.length >= 2 && !parts[0].includes('.') && !['settings', 'marketplace', 'explore', 'topics', 'collections', 'trending'].includes(parts[0]);
  }

  function getRepoInfo() {
    const path = window.location.pathname;
    const parts = path.split('/').filter(p => p);
    if (parts.length < 2) return null;
    
    return {
      owner: parts[0],
      repo: parts[1].split('/')[0] // Remove any trailing paths
    };
  }

  function createVaultButton() {
    const btn = document.createElement('li');
    btn.className = 'repovault-btn-wrapper';
    btn.innerHTML = `
      <button id="repovault-save-btn" class="btn btn-sm" type="button" aria-label="Save to RepoVault" title="Save to RepoVault">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: text-bottom;">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
          <polyline points="17 21 17 13 7 13 7 21"></polyline>
          <polyline points="7 3 7 8 15 8"></polyline>
        </svg>
        <span>Vault</span>
      </button>
      <span id="repovault-toast" class="repovault-toast"></span>
    `;
    
    // Apply GitHub's styling
    const button = btn.querySelector('#repovault-save-btn');
    button.style.backgroundColor = '#238636';
    button.style.color = '#ffffff';
    button.style.border = '1px solid rgba(240,246,252,0.1)';
    button.style.borderRadius = '6px';
    button.style.fontWeight = '500';
    button.style.display = 'inline-flex';
    button.style.alignItems = 'center';
    button.style.gap = '4px';
    
    button.addEventListener('click', handleVaultClick);
    
    return btn;
  }

  async function handleVaultClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const btn = document.getElementById('repovault-save-btn');
    const repoInfo = getRepoInfo();
    
    if (!repoInfo) return;
    
    btn.disabled = true;
    btn.style.opacity = '0.7';
    
    try {
      // Check if already saved
      const result = await chrome.storage.sync.get('bookmarks');
      const bookmarks = result.bookmarks || [];
      const exists = bookmarks.some(b => 
        b.owner === repoInfo.owner && b.repo === repoInfo.repo
      );
      
      if (exists) {
        showToast('Already in Vault!', 'warning');
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>Saved</span>
        `;
        btn.style.backgroundColor = '#1f6feb';
      } else {
        // Fetch metadata
        const metadata = await fetchRepoMetadata(repoInfo.owner, repoInfo.repo);
        
        // Save bookmark
        const bookmark = {
          id: Date.now(),
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          url: `https://github.com/${repoInfo.owner}/${repoInfo.repo}`,
          category: metadata.suggestedCategory || 'uncategorized',
          notes: '',
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
        await chrome.storage.sync.set({ bookmarks });
        
        showToast('Saved to Vault!', 'success');
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>Saved</span>
        `;
        btn.style.backgroundColor = '#1f6feb';
      }
    } catch (err) {
      console.error('RepoVault error:', err);
      showToast('Failed to save', 'error');
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  }

  async function fetchRepoMetadata(owner, repo) {
    try {
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'RepoVault-Extension'
        }
      });
      
      if (!response.ok) {
        if (response.status === 403) {
          // Rate limited - return basic info
          return { suggestedCategory: 'uncategorized' };
        }
        throw new Error('Failed to fetch metadata');
      }
      
      const data = await response.json();
      
      // Calculate health status
      const lastPush = new Date(data.pushed_at);
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      
      let healthStatus = 'healthy';
      if (data.archived) {
        healthStatus = 'archived';
      } else if (lastPush < twoYearsAgo) {
        healthStatus = 'stale';
      }
      
      // Smart categorization based on topics
      const suggestedCategory = categorizeRepo(data.topics, data.language);
      
      return {
        description: data.description,
        stars: data.stargazers_count,
        language: data.language,
        lastCommit: data.pushed_at,
        topics: data.topics || [],
        archived: data.archived,
        healthStatus: suggestedCategory,
        suggestedCategory
      };
    } catch (err) {
      console.warn('Metadata fetch failed:', err);
      return { suggestedCategory: 'uncategorized' };
    }
  }

  function categorizeRepo(topics, language) {
    const topicMap = {
      'react': 'Frontend',
      'vue': 'Frontend',
      'angular': 'Frontend',
      'svelte': 'Frontend',
      'frontend': 'Frontend',
      'ui': 'Frontend',
      'component': 'Frontend',
      
      'node': 'Backend',
      'nodejs': 'Backend',
      'express': 'Backend',
      'django': 'Backend',
      'flask': 'Backend',
      'backend': 'Backend',
      'api': 'Backend',
      'server': 'Backend',
      
      'machine-learning': 'ML/AI',
      'deep-learning': 'ML/AI',
      'ai': 'ML/AI',
      'neural-network': 'ML/AI',
      'tensorflow': 'ML/AI',
      'pytorch': 'ML/AI',
      'nlp': 'ML/AI',
      
      'devops': 'DevOps',
      'docker': 'DevOps',
      'kubernetes': 'DevOps',
      'ci-cd': 'DevOps',
      'terraform': 'DevOps',
      'ansible': 'DevOps',
      'infrastructure': 'DevOps',
      
      'mobile': 'Mobile',
      'android': 'Mobile',
      'ios': 'Mobile',
      'react-native': 'Mobile',
      'flutter': 'Mobile',
      
      'tool': 'Tools',
      'cli': 'Tools',
      'utility': 'Tools',
      'plugin': 'Tools',
      'extension': 'Tools'
    };
    
    // Check topics first
    for (const topic of topics) {
      const lowerTopic = topic.toLowerCase();
      if (topicMap[lowerTopic]) {
        return topicMap[lowerTopic];
      }
    }
    
    // Fallback to language-based categorization
    const langMap = {
      'JavaScript': 'Frontend',
      'TypeScript': 'Frontend',
      'HTML': 'Frontend',
      'CSS': 'Frontend',
      'Python': 'Backend',
      'Go': 'Backend',
      'Rust': 'Backend',
      'Java': 'Backend',
      'Ruby': 'Backend',
      'PHP': 'Backend',
      'Swift': 'Mobile',
      'Kotlin': 'Mobile',
      'Dart': 'Mobile',
      'C++': 'Systems',
      'C': 'Systems',
      'Shell': 'DevOps'
    };
    
    return langMap[language] || 'uncategorized';
  }

  function showToast(message, type) {
    const toast = document.getElementById('repovault-toast');
    if (!toast) return;
    
    toast.textContent = message;
    toast.className = `repovault-toast show ${type}`;
    
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  }

  function injectVaultButton() {
    // Remove existing button if any
    const existing = document.querySelector('.repovault-btn-wrapper');
    if (existing) existing.remove();
    
    // Try multiple selectors for different GitHub UI versions
    const selectors = [
      '.pagehead-actions', // Classic
      '[data-testid="star-button"]', // New UI
      '.BorderGrid-cell:first-child', // Alternative
      'h1.public + div ul, h1.private + div ul', // Near header
      '[data-target="gist-button"]', // Gist pages
      '.repository-content .BorderGrid--spacious .BorderGrid-cell' // Repo home
    ];
    
    let target = null;
    for (const selector of selectors) {
      target = document.querySelector(selector);
      if (target) break;
    }
    
    if (!target) {
      // Retry if DOM not ready
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        setTimeout(injectVaultButton, 500);
      }
      return;
    }
    
    const vaultBtn = createVaultButton();
    
    // Insert in appropriate location
    if (target.classList.contains('pagehead-actions')) {
      target.insertBefore(vaultBtn, target.firstChild);
    } else if (target.tagName === 'UL') {
      target.appendChild(vaultBtn);
    } else {
      // Create actions list if doesn't exist
      const actionsList = document.createElement('ul');
      actionsList.className = 'pagehead-actions flex-shrink-0 d-none d-md-inline';
      actionsList.appendChild(vaultBtn);
      
      const header = document.querySelector('h1.public, h1.private, [data-testid="repo-header"]');
      if (header && header.parentElement) {
        header.parentElement.appendChild(actionsList);
      }
    }
    
    // Check if already saved to update button state
    checkExistingSave();
  }

  async function checkExistingSave() {
    const repoInfo = getRepoInfo();
    if (!repoInfo) return;
    
    try {
      const result = await chrome.storage.sync.get('bookmarks');
      const bookmarks = result.bookmarks || [];
      const exists = bookmarks.some(b => 
        b.owner === repoInfo.owner && b.repo === repoInfo.repo
      );
      
      if (exists) {
        const btn = document.getElementById('repovault-save-btn');
        if (btn) {
          btn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>Saved</span>
          `;
          btn.style.backgroundColor = '#1f6feb';
          btn.disabled = true;
        }
      }
    } catch (err) {
      console.warn('Failed to check existing save:', err);
    }
  }

  function startObserver() {
    if (observer) observer.disconnect();
    
    observer = new MutationObserver((mutations) => {
      const btn = document.querySelector('.repovault-btn-wrapper');
      if (!btn && isRepoPage()) {
        injectVaultButton();
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Listen for navigation changes (GitHub SPA navigation)
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      retryCount = 0;
      setTimeout(init, 100);
    }
  }).observe(document, { subtree: true, childList: true });

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
