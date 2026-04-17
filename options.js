document.addEventListener('DOMContentLoaded', () => {
    const defaultFolderInput = document.getElementById('defaultFolder');
    const defaultQualitySelect = document.getElementById('defaultQuality');
    const defaultSubtitleInput = document.getElementById('defaultSubtitle');
    const defaultAssetsCheck = document.getElementById('defaultAssets');
    const settingsForm = document.getElementById('settingsForm');
    const saveStatus = document.getElementById('saveStatus');

    // Load saved settings from LocalStorage
    defaultFolderInput.value = localStorage.getItem('default_folder') || "Udemy Download/";
    defaultQualitySelect.value = localStorage.getItem('default_quality') || "1080";
    defaultSubtitleInput.value = localStorage.getItem('default_subtitle') || "en_US";
    
    const assetsPref = localStorage.getItem('default_assets');
    if (assetsPref !== null) {
        defaultAssetsCheck.checked = (assetsPref === 'true');
    } else {
        defaultAssetsCheck.checked = true;
    }

    settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();

        let folderPath = defaultFolderInput.value.trim();
        // ensure suffix integrity
        if (folderPath && !folderPath.endsWith('/')) {
            folderPath += '/';
            defaultFolderInput.value = folderPath;
        }

        // Save new settings
        localStorage.setItem('default_folder', folderPath || "Udemy Download/");
        localStorage.setItem('default_quality', defaultQualitySelect.value);
        localStorage.setItem('default_subtitle', defaultSubtitleInput.value.trim());
        localStorage.setItem('default_assets', defaultAssetsCheck.checked ? 'true' : 'false');

        // Visual confirmation
        saveStatus.style.opacity = '1';
        setTimeout(() => {
            saveStatus.style.opacity = '0';
        }, 2000);
    });
});