document.addEventListener('DOMContentLoaded', () => {
    const defaultFolderInput = document.getElementById('defaultFolder');
    const namingTemplateInput = document.getElementById('namingTemplate');
    const defaultQualitySelect = document.getElementById('defaultQuality');
    const defaultSubtitleInput = document.getElementById('defaultSubtitle');
    const defaultAssetsCheck = document.getElementById('defaultAssets');
    const apiDelayInput = document.getElementById('apiDelay');
    const downloadDelayInput = document.getElementById('downloadDelay');
    const settingsForm = document.getElementById('settingsForm');
    const saveStatus = document.getElementById('saveStatus');

    // Load saved settings from LocalStorage
    defaultFolderInput.value = localStorage.getItem('default_folder') || "Udemy Download/";
    namingTemplateInput.value = localStorage.getItem('default_naming_template') || "{instructor}/{course}/{chapter}/{video_index}. {video_title}";
    defaultQualitySelect.value = localStorage.getItem('default_quality') || "1080";
    defaultSubtitleInput.value = localStorage.getItem('default_subtitle') || "en_US";
    apiDelayInput.value = localStorage.getItem('api_delay') || "500";
    downloadDelayInput.value = localStorage.getItem('download_delay') || "2000";
    
    const assetsPref = localStorage.getItem('default_assets');
    if (assetsPref !== null) {
        defaultAssetsCheck.checked = (assetsPref === 'true');
    } else {
        defaultAssetsCheck.checked = true;
    }

    settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();

        let folderPath = defaultFolderInput.value.trim();

        // chrome.downloads only allows paths relative to the system Downloads folder.
        // Strip any Windows absolute prefix (e.g. "F:/" or "C:\") silently.
        folderPath = folderPath
            .replace(/^[A-Za-z]:[\\\/]+/, '')  // remove drive letter
            .replace(/^[\\\/]+/, '');            // remove leading slashes

        // ensure trailing slash
        if (folderPath && !folderPath.endsWith('/')) {
            folderPath += '/';
        }
        defaultFolderInput.value = folderPath;

        // Save new settings
        localStorage.setItem('default_folder', folderPath || "Udemy Download/");
        localStorage.setItem('default_naming_template', namingTemplateInput.value.trim() || "{instructor}/{course}/{chapter}/{video_index}. {video_title}");
        localStorage.setItem('default_quality', defaultQualitySelect.value);
        localStorage.setItem('default_subtitle', defaultSubtitleInput.value.trim());
        localStorage.setItem('default_assets', defaultAssetsCheck.checked ? 'true' : 'false');
        localStorage.setItem('api_delay', apiDelayInput.value.trim() || "500");
        localStorage.setItem('download_delay', downloadDelayInput.value.trim() || "2000");

        // Visual confirmation
        saveStatus.style.opacity = '1';
        setTimeout(() => {
            saveStatus.style.opacity = '0';
        }, 2000);
    });
});