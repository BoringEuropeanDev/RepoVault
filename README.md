# RepoVault

A lightweight Chrome extension to bookmark and organize your favorite GitHub repositories.

## What is it?

RepoVault lets you:
- **Bookmark** GitHub repos with one click
- **Organize** bookmarks by category (React, Tools, Learning, etc.)
- **Search** through your bookmarks instantly
- **Add notes** to remember why you saved each repo
- **Export/Import** your data anytime

## Why use it?

Stop losing track of awesome repos. Stop searching "that cool library I found last week". RepoVault keeps everything organized in your browser.

## Install

### For Users

1. Download this repo: `git clone https://github.com/yourusername/repovault.git`
2. Open Chrome and go to `chrome://extensions/`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the `repovault` folder
6. Done! The extension is now in your Chrome toolbar

### For Developers

Want to contribute or modify it? Clone the repo and follow the same steps above. The code is simple and well-commented.

## How to use

### Add a bookmark
1. Click the RepoVault icon
2. Go to "Add Repo" tab
3. Paste a GitHub URL
4. (Optional) Add a category and notes
5. Click "Save"

### Find bookmarks
- Use the search box to find by repo name, owner, or notes
- Filter by category with the dropdown

### Manage bookmarks
- **Copy** → Copy the URL
- **Open** → Open in new tab
- **Delete** → Remove from bookmarks

### Backup your data
- Go to Settings tab
- Click "Export as JSON" to download your bookmarks
- Click "Import JSON" to restore from a backup file

## Features

✅ Search & filter bookmarks  
✅ Organize by category  
✅ Add custom notes  
✅ Export/import as JSON  
✅ Clean, minimal UI  
✅ No login required  
✅ All data stored locally (100% private)  
✅ Works offline  

## Tech Stack

- Vanilla JavaScript (no dependencies)
- Chrome Storage API
- Manifest V3

## File Structure

repovault/
├── manifest.json # Extension config
├── popup.html # Main UI
├── popup.css # Styling
├── popup.js # Core logic
├── background.js # Service worker
├── icons/ # Extension icons
└── README.md


## Browser Support

Works on:
- Chrome 88+
- Edge, Brave, Opera, and other Chromium browsers

## FAQ

**Q: Is my data safe?**  
A: Yes. All bookmarks are stored locally on your computer. No data is sent to servers.

**Q: Can I use this on multiple computers?**  
A: Not automatically, but you can export your bookmarks and import them on another computer.

**Q: Can I sync across devices?**  
A: Not yet. You can manually export/import, or feel free to submit a feature request!

**Q: Is it free?**  
A: Yes, 100% free and open source.

## Contributing

Found a bug? Have a feature idea? Fork the repo and submit a pull request!

## License

MIT - Do whatever you want with it

---

**Made for developers who love staying organized** 🚀
