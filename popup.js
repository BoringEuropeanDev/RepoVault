// State management
let bookmarks = [];

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  await loadBookmarks();
  setupTabs();
  setupEventListeners();
  renderBookmarks();
  updateCategoryFilter();
});

// Load bookmarks from Chrome storage
async function loadBookmarks() {
  const result = await chrome.storage.local.get('bookmarks');
  bookmarks = result.bookmarks || [];
}

// Save bookmarks to Chrome storage
async function saveBookmarks() {
  await chrome.storage.local.set({ bookmarks });
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
  
  // Search
  document.getElementById('searchInput').addEventListener('input', renderBookmarks);
  
  // Filter
  document.getElementById('categoryFilter').addEventListener('change', renderBookmarks);
  
  // Settings
  document.getElementById('exportBtn').addEventListener('click', exportBookmarks);
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', importBookmarks);
  document.getElementById('clearBtn').addEventListener('click', clearAll);
}

// ========== ADD REPO ==========
async function addRepo() {
  const url = document.getElementById('repoUrl').value.trim();
  const category = document.getElementById('repoCategory').value.trim();
  const notes = document.getElementById('repoNotes').value.trim();

  if (!url) {
    showStatus('enter a repo URL', 'error');
    return;
  }

  if (!url.includes('github.com')) {
    showStatus('must be a GitHub URL', 'error');
    return;
  }

  // Parse GitHub URL
  const parts = url
    .replace(/https?:\/\/(www\.)?github\.com\//, '')
    .split('/')
    .filter(p => p);

  const owner = parts[0];
  const repo = parts[1];

  if (!owner || !repo) {
    showStatus('invalid GitHub URL format', 'error');
    return;
  }

  // Check if already bookmarked
  if (bookmarks.some(b => b.owner === owner && b.repo === repo)) {
    showStatus('already bookmarked!', 'error');
    return;
  }

  const bookmark = {
    id: Date.now(),
    owner,
    repo,
    category: category || 'uncategorized',
    notes,
    url: `https://github.com/${owner}/${repo}`,
    savedAt: new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  };

  bookmarks.push(bookmark);
  await saveBookmarks();
  
  // Clear form
  document.getElementById('repoUrl').value = '';
  document.getElementById('repoCategory').value = '';
  document.getElementById('repoNotes').value = '';
  
  showStatus('bookmark saved!', 'success');
  updateCategoryFilter();
  renderBookmarks();
}

// ========== RENDER BOOKMARKS ==========
function renderBookmarks() {
  const searchTerm = document.getElementById('searchInput').value.toLowerCase();
  const selectedCategory = document.getElementById('categoryFilter').value;
  const list = document.getElementById('bookmarksList');
  const empty = document.getElementById('emptyState');

  let filtered = bookmarks.filter(b => {
    const matchesSearch = 
      b.repo.toLowerCase().includes(searchTerm) ||
      b.owner.toLowerCase().includes(searchTerm) ||
      b.notes.toLowerCase().includes(searchTerm);
    
    const matchesCategory = !selectedCategory || b.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  if (filtered.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  
  list.innerHTML = filtered
    .sort((a, b) => b.id - a.id) // Newest first
    .map(b => `
      <div class="bookmark-item">
        <div class="bookmark-title">
          <a href="${b.url}" target="_blank">
            ${b.owner}/<strong>${b.repo}</strong>
          </a>
        </div>
        <div style="margin-bottom: 6px;">
          <span class="bookmark-category">${b.category}</span>
        </div>
        ${b.notes ? `<div class="bookmark-notes">"${b.notes}"</div>` : ''}
        <div class="bookmark-meta">saved ${b.savedAt}</div>
        <div class="bookmark-actions">
          <button onclick="copyLink('${b.url}')">📋 Copy</button>
          <button onclick="openRepo('${b.url}')">🔗 Open</button>
          <button onclick="deleteBookmark(${b.id})" class="delete">🗑️ Delete</button>
        </div>
      </div>
    `)
    .join('');
}

// ========== BOOKMARK ACTIONS ==========
function copyLink(url) {
  navigator.clipboard.writeText(url);
  showStatus('link copied!', 'success');
}

function openRepo(url) {
  chrome.tabs.create({ url });
}

async function deleteBookmark(id) {
  bookmarks = bookmarks.filter(b => b.id !== id);
  await saveBookmarks();
  renderBookmarks();
  updateCategoryFilter();
}

// ========== CATEGORY FILTER ==========
function updateCategoryFilter() {
  const select = document.getElementById('categoryFilter');
  const categories = [...new Set(bookmarks.map(b => b.category))].sort();
  const current = select.value;
  
  select.innerHTML = '<option value="">all categories</option>';
  
  categories.forEach(cat => {
    const option = document.createElement('option');
    option.value = cat;
    option.textContent = cat;
    select.appendChild(option);
  });
  
  select.value = current;
}

// ========== EXPORT / IMPORT ==========
function exportBookmarks() {
  const data = JSON.stringify(bookmarks, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `repovault-backup-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showStatus('exported!', 'success');
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
      
      // Validate structure
      imported.forEach(item => {
        if (!item.owner || !item.repo || !item.url) {
          throw new Error('Invalid bookmark structure');
        }
      });
      
      // Merge with existing (avoid duplicates)
      const existingUrls = new Set(bookmarks.map(b => b.url));
      const newBookmarks = imported.filter(b => !existingUrls.has(b.url));
      
      bookmarks = [...bookmarks, ...newBookmarks];
      await saveBookmarks();
      
      renderBookmarks();
      updateCategoryFilter();
      showStatus(`imported ${newBookmarks.length} bookmarks!`, 'success');
    } catch (err) {
      showStatus('invalid file format', 'error');
    }
  };
  
  reader.readAsText(file);
  
  // Reset file input
  e.target.value = '';
}

// ========== CLEAR ALL ==========
async function clearAll() {
  if (confirm('delete ALL bookmarks? this cannot be undone.')) {
    bookmarks = [];
    await saveBookmarks();
    renderBookmarks();
    updateCategoryFilter();
    showStatus('cleared!', 'success');
  }
}

// ========== STATUS MESSAGES ==========
function showStatus(msg, type) {
  const status = document.getElementById('status');
  status.textContent = msg;
  status.className = `status ${type}`;
  
  setTimeout(() => {
    status.className = 'status';
  }, 3000);
}
