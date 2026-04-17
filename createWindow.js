var windowNotOpenTitle = 'Open popup window';
var windowIsOpenTitle = 'Popup window is already open. Click to focus popup.';

chrome.action.onClicked.addListener(function () {
    let width= 1092;
    let height= 700;
    
    // Stateless check for an existing popup window
    chrome.windows.getAll({ populate: true }, function(windows) {
        let existingWindow = false;
        
        for (let win of windows) {
            for (let tab of win.tabs) {
                // If we find our popup HTML open...
                if (tab.url && tab.url.includes("popup.html")) {
                    existingWindow = win.id;
                    break;
                }
            }
            if (existingWindow) break;
        }

        if (existingWindow === false) {
            chrome.action.setTitle({title:windowIsOpenTitle});
            chrome.windows.create({ 
                'url': 'popup.html', 
                'type': 'popup',
                'width': width,
                'height': height,
                'focused': true
            });
        } else {
            // The window is open, so focus it.
            chrome.windows.update(existingWindow, { focused: true });
        }
    });
});

chrome.windows.onRemoved.addListener(function (winId){
    // Reset the title when the window is closed
    chrome.windows.getAll({ populate: true }, function(windows) {
        let isPopupStillOpen = false;
        for (let win of windows) {
            for (let tab of win.tabs) {
                if (tab.url && tab.url.includes("popup.html")) {
                    isPopupStillOpen = true;
                    break;
                }
            }
        }
        if (!isPopupStillOpen) {
            chrome.action.setTitle({title:windowNotOpenTitle});
        }
    });
});