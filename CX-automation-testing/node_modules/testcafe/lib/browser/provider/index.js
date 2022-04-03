"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const debug_1 = __importDefault(require("debug"));
const testcafe_browser_tools_1 = __importDefault(require("testcafe-browser-tools"));
const os_family_1 = __importDefault(require("os-family"));
const path_1 = require("path");
const make_dir_1 = __importDefault(require("make-dir"));
const connection_1 = __importDefault(require("../connection"));
const delay_1 = __importDefault(require("../../utils/delay"));
const client_functions_1 = require("./utils/client-functions");
const warning_message_1 = __importDefault(require("../../notifications/warning-message"));
const DEBUG_LOGGER = debug_1.default('testcafe:browser:provider');
const BROWSER_OPENING_DELAY = 2000;
const RESIZE_DIFF_SIZE = {
    width: 100,
    height: 100
};
function sumSizes(sizeA, sizeB) {
    return {
        width: sizeA.width + sizeB.width,
        height: sizeA.height + sizeB.height
    };
}
function subtractSizes(sizeA, sizeB) {
    return {
        width: sizeA.width - sizeB.width,
        height: sizeA.height - sizeB.height
    };
}
class BrowserProvider {
    constructor(plugin) {
        this.plugin = plugin;
        this.initPromise = Promise.resolve(false);
        this.isMultiBrowser = this.plugin.isMultiBrowser;
        // HACK: The browser window has different border sizes in normal and maximized modes. So, we need to be sure that the window is
        // not maximized before resizing it in order to keep the mechanism of correcting the client area size working. When browser is started,
        // we are resizing it for the first time to switch the window to normal mode, and for the second time - to restore the client area size.
        this.localBrowsersInfo = {};
    }
    _ensureLocalBrowserInfo(browserId) {
        if (this.localBrowsersInfo[browserId])
            return;
        this.localBrowsersInfo[browserId] = {
            windowDescriptor: null,
            maxScreenSize: null,
            resizeCorrections: null
        };
    }
    _getWindowDescriptor(browserId) {
        return this.localBrowsersInfo[browserId] && this.localBrowsersInfo[browserId].windowDescriptor;
    }
    _getMaxScreenSize(browserId) {
        return this.localBrowsersInfo[browserId] && this.localBrowsersInfo[browserId].maxScreenSize;
    }
    _getResizeCorrections(browserId) {
        return this.localBrowsersInfo[browserId] && this.localBrowsersInfo[browserId].resizeCorrections;
    }
    _isBrowserIdle(browserId) {
        const connection = connection_1.default.getById(browserId);
        return connection.idle;
    }
    async _calculateResizeCorrections(browserId) {
        if (!this._isBrowserIdle(browserId))
            return;
        const title = await this.plugin.runInitScript(browserId, client_functions_1.GET_TITLE_SCRIPT);
        if (!await testcafe_browser_tools_1.default.isMaximized(title))
            return;
        const currentSize = await this.plugin.runInitScript(browserId, client_functions_1.GET_WINDOW_DIMENSIONS_INFO_SCRIPT);
        const etalonSize = subtractSizes(currentSize, RESIZE_DIFF_SIZE);
        await testcafe_browser_tools_1.default.resize(title, currentSize.width, currentSize.height, etalonSize.width, etalonSize.height);
        let resizedSize = await this.plugin.runInitScript(browserId, client_functions_1.GET_WINDOW_DIMENSIONS_INFO_SCRIPT);
        let correctionSize = subtractSizes(resizedSize, etalonSize);
        await testcafe_browser_tools_1.default.resize(title, resizedSize.width, resizedSize.height, etalonSize.width, etalonSize.height);
        resizedSize = await this.plugin.runInitScript(browserId, client_functions_1.GET_WINDOW_DIMENSIONS_INFO_SCRIPT);
        correctionSize = sumSizes(correctionSize, subtractSizes(resizedSize, etalonSize));
        if (this.localBrowsersInfo[browserId])
            this.localBrowsersInfo[browserId].resizeCorrections = correctionSize;
        await testcafe_browser_tools_1.default.maximize(title);
    }
    async _calculateMacSizeLimits(browserId) {
        if (!this._isBrowserIdle(browserId))
            return;
        const sizeInfo = await this.plugin.runInitScript(browserId, client_functions_1.GET_WINDOW_DIMENSIONS_INFO_SCRIPT);
        if (this.localBrowsersInfo[browserId]) {
            this.localBrowsersInfo[browserId].maxScreenSize = {
                width: sizeInfo.availableWidth - (sizeInfo.outerWidth - sizeInfo.width),
                height: sizeInfo.availableHeight - (sizeInfo.outerHeight - sizeInfo.height)
            };
        }
    }
    async _ensureBrowserWindowDescriptor(browserId) {
        if (this._getWindowDescriptor(browserId))
            return;
        await this._ensureLocalBrowserInfo(browserId);
        // NOTE: delay to ensure the window finished the opening
        await this.plugin.waitForConnectionReady(browserId);
        await delay_1.default(BROWSER_OPENING_DELAY);
        if (this.localBrowsersInfo[browserId]) {
            const connection = connection_1.default.getById(browserId);
            let windowDescriptor = null;
            try {
                windowDescriptor = await testcafe_browser_tools_1.default.findWindow(browserId);
            }
            catch (err) {
                // NOTE: We can suppress the error here since we can just disable window manipulation functions
                // when we cannot find a local window descriptor
                DEBUG_LOGGER(err);
                connection.addWarning(warning_message_1.default.cannotFindWindowDescriptorError, connection.browserInfo.alias, err.message);
            }
            this.localBrowsersInfo[browserId].windowDescriptor = windowDescriptor;
        }
    }
    async _ensureBrowserWindowParameters(browserId) {
        await this._ensureBrowserWindowDescriptor(browserId);
        if (os_family_1.default.win && !this._getResizeCorrections(browserId))
            await this._calculateResizeCorrections(browserId);
        else if (os_family_1.default.mac && !this._getMaxScreenSize(browserId))
            await this._calculateMacSizeLimits(browserId);
    }
    async _closeLocalBrowser(browserId) {
        if (this.plugin.needCleanUpBrowserInfo)
            this.plugin.cleanUpBrowserInfo(browserId);
        const windowDescriptor = this._getWindowDescriptor(browserId);
        await testcafe_browser_tools_1.default.close(windowDescriptor);
    }
    async _resizeLocalBrowserWindow(browserId, width, height, currentWidth, currentHeight) {
        const resizeCorrections = this._getResizeCorrections(browserId);
        if (resizeCorrections && await testcafe_browser_tools_1.default.isMaximized(this._getWindowDescriptor(browserId))) {
            width -= resizeCorrections.width;
            height -= resizeCorrections.height;
        }
        await testcafe_browser_tools_1.default.resize(this._getWindowDescriptor(browserId), currentWidth, currentHeight, width, height);
    }
    async _takeLocalBrowserScreenshot(browserId, screenshotPath) {
        await testcafe_browser_tools_1.default.screenshot(this._getWindowDescriptor(browserId), screenshotPath);
    }
    async _canResizeLocalBrowserWindowToDimensions(browserId, width, height) {
        if (!os_family_1.default.mac)
            return true;
        const maxScreenSize = this._getMaxScreenSize(browserId);
        return width <= maxScreenSize.width && height <= maxScreenSize.height;
    }
    async _maximizeLocalBrowserWindow(browserId) {
        await testcafe_browser_tools_1.default.maximize(this._getWindowDescriptor(browserId));
    }
    async canUseDefaultWindowActions(browserId) {
        const isLocalBrowser = await this.plugin.isLocalBrowser(browserId);
        const isHeadlessBrowser = await this.plugin.isHeadlessBrowser(browserId);
        return isLocalBrowser && !isHeadlessBrowser;
    }
    async init() {
        const initialized = await this.initPromise;
        if (initialized)
            return;
        this.initPromise = this.plugin
            .init()
            .then(() => true);
        try {
            await this.initPromise;
        }
        catch (error) {
            this.initPromise = Promise.resolve(false);
            throw error;
        }
    }
    async dispose() {
        const initialized = await this.initPromise;
        if (!initialized)
            return;
        this.initPromise = this.plugin
            .dispose()
            .then(() => false);
        try {
            await this.initPromise;
        }
        catch (error) {
            this.initPromise = Promise.resolve(false);
            throw error;
        }
    }
    async isLocalBrowser(browserId, browserName) {
        return await this.plugin.isLocalBrowser(browserId, browserName);
    }
    isHeadlessBrowser(browserId, browserName) {
        return this.plugin.isHeadlessBrowser(browserId, browserName);
    }
    async openBrowser(browserId, pageUrl, browserName, disableMultipleWindows) {
        await this.plugin.openBrowser(browserId, pageUrl, browserName, disableMultipleWindows);
        if (await this.canUseDefaultWindowActions(browserId))
            await this._ensureBrowserWindowParameters(browserId);
    }
    async closeBrowser(browserId) {
        const canUseDefaultWindowActions = await this.canUseDefaultWindowActions(browserId);
        const customActionsInfo = await this.hasCustomActionForBrowser(browserId);
        const hasCustomCloseBrowser = customActionsInfo.hasCloseBrowser;
        const usePluginsCloseBrowser = hasCustomCloseBrowser || !canUseDefaultWindowActions;
        if (usePluginsCloseBrowser)
            await this.plugin.closeBrowser(browserId);
        else
            await this._closeLocalBrowser(browserId);
        if (canUseDefaultWindowActions)
            delete this.localBrowsersInfo[browserId];
    }
    async getBrowserList() {
        return await this.plugin.getBrowserList();
    }
    async isValidBrowserName(browserName) {
        return await this.plugin.isValidBrowserName(browserName);
    }
    async resizeWindow(browserId, width, height, currentWidth, currentHeight) {
        const canUseDefaultWindowActions = await this.canUseDefaultWindowActions(browserId);
        const customActionsInfo = await this.hasCustomActionForBrowser(browserId);
        const hasCustomResizeWindow = customActionsInfo.hasResizeWindow;
        if (canUseDefaultWindowActions && !hasCustomResizeWindow) {
            await this._resizeLocalBrowserWindow(browserId, width, height, currentWidth, currentHeight);
            return;
        }
        await this.plugin.resizeWindow(browserId, width, height, currentWidth, currentHeight);
    }
    async canResizeWindowToDimensions(browserId, width, height) {
        const canUseDefaultWindowActions = await this.canUseDefaultWindowActions(browserId);
        const customActionsInfo = await this.hasCustomActionForBrowser(browserId);
        const hasCustomCanResizeToDimensions = customActionsInfo.hasCanResizeWindowToDimensions;
        if (canUseDefaultWindowActions && !hasCustomCanResizeToDimensions)
            return await this._canResizeLocalBrowserWindowToDimensions(browserId, width, height);
        return await this.plugin.canResizeWindowToDimensions(browserId, width, height);
    }
    async maximizeWindow(browserId) {
        const canUseDefaultWindowActions = await this.canUseDefaultWindowActions(browserId);
        const customActionsInfo = await this.hasCustomActionForBrowser(browserId);
        const hasCustomMaximizeWindow = customActionsInfo.hasMaximizeWindow;
        if (canUseDefaultWindowActions && !hasCustomMaximizeWindow)
            return await this._maximizeLocalBrowserWindow(browserId);
        return await this.plugin.maximizeWindow(browserId);
    }
    async takeScreenshot(browserId, screenshotPath, pageWidth, pageHeight, fullPage) {
        const canUseDefaultWindowActions = await this.canUseDefaultWindowActions(browserId);
        const customActionsInfo = await this.hasCustomActionForBrowser(browserId);
        const hasCustomTakeScreenshot = customActionsInfo.hasTakeScreenshot;
        const connection = connection_1.default.getById(browserId);
        const takeLocalBrowsersScreenshot = canUseDefaultWindowActions && !hasCustomTakeScreenshot;
        const isLocalFullPageMode = takeLocalBrowsersScreenshot && fullPage;
        if (isLocalFullPageMode) {
            connection.addWarning(warning_message_1.default.screenshotsFullPageNotSupported, connection.browserInfo.alias);
            return;
        }
        await make_dir_1.default(path_1.dirname(screenshotPath));
        if (takeLocalBrowsersScreenshot)
            await this._takeLocalBrowserScreenshot(browserId, screenshotPath);
        else
            await this.plugin.takeScreenshot(browserId, screenshotPath, pageWidth, pageHeight, fullPage);
    }
    async getVideoFrameData(browserId) {
        return this.plugin.getVideoFrameData(browserId);
    }
    async hasCustomActionForBrowser(browserId) {
        return this.plugin.hasCustomActionForBrowser(browserId);
    }
    async reportJobResult(browserId, status, data) {
        await this.plugin.reportJobResult(browserId, status, data);
    }
    getActiveWindowId(browserId) {
        if (!this.plugin.supportMultipleWindows)
            return null;
        return this.plugin.getActiveWindowId(browserId);
    }
    setActiveWindowId(browserId, val) {
        this.plugin.setActiveWindowId(browserId, val);
    }
}
exports.default = BrowserProvider;
module.exports = exports.default;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYnJvd3Nlci9wcm92aWRlci9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7OztBQUFBLGtEQUEwQjtBQUMxQixvRkFBa0Q7QUFDbEQsMERBQTJCO0FBQzNCLCtCQUErQjtBQUMvQix3REFBK0I7QUFDL0IsK0RBQThDO0FBQzlDLDhEQUFzQztBQUN0QywrREFBK0Y7QUFDL0YsMEZBQWtFO0FBSWxFLE1BQU0sWUFBWSxHQUFHLGVBQUssQ0FBQywyQkFBMkIsQ0FBQyxDQUFDO0FBRXhELE1BQU0scUJBQXFCLEdBQUcsSUFBSSxDQUFDO0FBRW5DLE1BQU0sZ0JBQWdCLEdBQUc7SUFDckIsS0FBSyxFQUFHLEdBQUc7SUFDWCxNQUFNLEVBQUUsR0FBRztDQUNkLENBQUM7QUFhRixTQUFTLFFBQVEsQ0FBRSxLQUFXLEVBQUUsS0FBVztJQUN2QyxPQUFPO1FBQ0gsS0FBSyxFQUFHLEtBQUssQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDLEtBQUs7UUFDakMsTUFBTSxFQUFFLEtBQUssQ0FBQyxNQUFNLEdBQUcsS0FBSyxDQUFDLE1BQU07S0FDdEMsQ0FBQztBQUNOLENBQUM7QUFFRCxTQUFTLGFBQWEsQ0FBRSxLQUFXLEVBQUUsS0FBVztJQUM1QyxPQUFPO1FBQ0gsS0FBSyxFQUFHLEtBQUssQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDLEtBQUs7UUFDakMsTUFBTSxFQUFFLEtBQUssQ0FBQyxNQUFNLEdBQUcsS0FBSyxDQUFDLE1BQU07S0FDdEMsQ0FBQztBQUNOLENBQUM7QUFFRCxNQUFxQixlQUFlO0lBTWhDLFlBQW9CLE1BQVc7UUFDM0IsSUFBSSxDQUFDLE1BQU0sR0FBVyxNQUFNLENBQUM7UUFDN0IsSUFBSSxDQUFDLFdBQVcsR0FBTSxPQUFPLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQzdDLElBQUksQ0FBQyxjQUFjLEdBQUcsSUFBSSxDQUFD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QUUsU0FBaUIsRUFBRSxNQUFjLEVBQUUsSUFBUztRQUN0RSxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsZUFBZSxDQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFDL0QsQ0FBQztJQUVNLGlCQUFpQixDQUFFLFNBQWlCO1FBQ3ZDLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLHNCQUFzQjtZQUNuQyxPQUFPLElBQUksQ0FBQztRQUVoQixPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsaUJBQWlCLENBQUMsU0FBUyxDQUFDLENBQUM7SUFDcEQsQ0FBQztJQUVNLGlCQUFpQixDQUFFLFNBQWlCLEVBQUUsR0FBVztRQUNwRCxJQUFJLENBQUMsTUFBTSxDQUFDLGlCQUFpQixDQUFDLFNBQVMsRUFBRSxHQUFHLENBQUMsQ0FBQztJQUNsRCxDQUFDO0NBQ0o7QUE1VUQsa0NBNFVDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGRlYnVnIGZyb20gJ2RlYnVnJztcbmltcG9ydCBicm93c2VyVG9vbHMgZnJvbSAndGVzdGNhZmUtYnJvd3Nlci10b29scyc7XG5pbXBvcnQgT1MgZnJvbSAnb3MtZmFtaWx5JztcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tICdwYXRoJztcbmltcG9ydCBtYWtlRGlyIGZyb20gJ21ha2UtZGlyJztcbmltcG9ydCBCcm93c2VyQ29ubmVjdGlvbiBmcm9tICcuLi9jb25uZWN0aW9uJztcbmltcG9ydCBkZWxheSBmcm9tICcuLi8uLi91dGlscy9kZWxheSc7XG5pbXBvcnQgeyBHRVRfVElUTEVfU0NSSVBULCBHRVRfV0lORE9XX0RJTUVOU0lPTlNfSU5GT19TQ1JJUFQgfSBmcm9tICcuL3V0aWxzL2NsaWVudC1mdW5jdGlvbnMnO1xuaW1wb3J0IFdBUk5JTkdfTUVTU0FHRSBmcm9tICcuLi8uLi9ub3RpZmljYXRpb25zL3dhcm5pbmctbWVzc2FnZSc7XG5pbXBvcnQgeyBEaWN0aW9uYXJ5IH0gZnJvbSAnLi4vLi4vY29uZmlndXJhdGlvbi9pbnRlcmZhY2VzJztcbmltcG9ydCB7IFdpbmRvd0RpbWVudGlvbnNJbmZvIH0gZnJvbSAnLi4vaW50ZXJmYWNlcyc7XG5cbmNvbnN0IERFQlVHX0xPR0dFUiA9IGRlYnVnKCd0ZXN0Y2FmZTpicm93c2VyOnByb3ZpZGVyJyk7XG5cbmNvbnN0IEJST1dTRVJfT1BFTklOR19ERUxBWSA9IDIwMDA7XG5cbmNvbnN0IFJFU0laRV9ESUZGX1NJWkUgPSB7XG4gICAgd2lkdGg6ICAxMDAsXG4gICAgaGVpZ2h0OiAxMDBcbn07XG5cbmludGVyZmFjZSBTaXplIHtcbiAgICB3aWR0aDogbnVtYmVyO1xuICAgIGhlaWdodDogbnVtYmVyO1xufVxuXG5pbnRlcmZhY2UgTG9jYWxCcm93c2VySW5mbyB7XG4gICAgd2luZG93RGVzY3JpcHRvcjogbnVsbCB8IHN0cmluZztcbiAgICBtYXhTY3JlZW5TaXplOiBudWxsIHwgU2l6ZTtcbiAgICByZXNpemVDb3JyZWN0aW9uczogbnVsbCB8IFNpemU7XG59XG5cbmZ1bmN0aW9uIHN1bVNpemVzIChzaXplQTogU2l6ZSwgc2l6ZUI6IFNpemUpOiBTaXplIHtcbiAgICByZXR1cm4ge1xuICAgICAgICB3aWR0aDogIHNpemVBLndpZHRoICsgc2l6ZUIud2lkdGgsXG4gICAgICAgIGhlaWdodDogc2l6ZUEuaGVpZ2h0ICsgc2l6ZUIuaGVpZ2h0XG4gICAgfTtcbn1cblxuZnVuY3Rpb24gc3VidHJhY3RTaXplcyAoc2l6ZUE6IFNpemUsIHNpemVCOiBTaXplKTogU2l6ZSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgd2lkdGg6ICBzaXplQS53aWR0aCAtIHNpemVCLndpZHRoLFxuICAgICAgICBoZWlnaHQ6IHNpemVBLmhlaWdodCAtIHNpemVCLmhlaWdodFxuICAgIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJyb3dzZXJQcm92aWRlciB7XG4gICAgcHJpdmF0ZSBwbHVnaW46IGFueTtcbiAgICBwcml2YXRlIGluaXRQcm9taXNlOiBQcm9taXNlPGFueT47XG4gICAgcHJpdmF0ZSBpc011bHRpQnJvd3NlcjogYm9vbGVhbjtcbiAgICBwcml2YXRlIHJlYWRvbmx5IGxvY2FsQnJvd3NlcnNJbmZvOiBEaWN0aW9uYXJ5PExvY2FsQnJvd3NlckluZm8+O1xuXG4gICAgcHVibGljIGNvbnN0cnVjdG9yIChwbHVnaW46IGFueSkge1xuICAgICAgICB0aGlzLnBsdWdpbiAgICAgICAgID0gcGx1Z2luO1xuICAgICAgICB0aGlzLmluaXRQcm9taXNlICAgID0gUHJvbWlzZS5yZXNvbHZlKGZhbHNlKTtcbiAgICAgICAgdGhpcy5pc011bHRpQnJvd3NlciA9IHRoaXMucGx1Z2luLmlzTXVsdGlCcm93c2VyO1xuICAgICAgICAvLyBIQUNLOiBUaGUgYnJvd3NlciB3aW5kb3cgaGFzIGRpZmZlcmVudCBib3JkZXIgc2l6ZXMgaW4gbm9ybWFsIGFuZCBtYXhpbWl6ZWQgbW9kZXMuIFNvLCB3ZSBuZWVkIHRvIGJlIHN1cmUgdGhhdCB0aGUgd2luZG93IGlzXG4gICAgICAgIC8vIG5vdCBtYXhpbWl6ZWQgYmVmb3JlIHJlc2l6aW5nIGl0IGluIG9yZGVyIHRvIGtlZXAgdGhlIG1lY2hhbmlzbSBvZiBjb3JyZWN0aW5nIHRoZSBjbGllbnQgYXJlYSBzaXplIHdvcmtpbmcuIFdoZW4gYnJvd3NlciBpcyBzdGFydGVkLFxuICAgICAgICAvLyB3ZSBhcmUgcmVzaXppbmcgaXQgZm9yIHRoZSBmaXJzdCB0aW1lIHRvIHN3aXRjaCB0aGUgd2luZG93IHRvIG5vcm1hbCBtb2RlLCBhbmQgZm9yIHRoZSBzZWNvbmQgdGltZSAtIHRvIHJlc3RvcmUgdGhlIGNsaWVudCBhcmVhIHNpemUuXG4gICAgICAgIHRoaXMubG9jYWxCcm93c2Vyc0luZm8gPSB7fTtcbiAgICB9XG5cbiAgICBwcml2YXRlIF9lbnN1cmVMb2NhbEJyb3dzZXJJbmZvIChicm93c2VySWQ6IHN0cmluZyk6IHZvaWQge1xuICAgICAgICBpZiAodGhpcy5sb2NhbEJyb3dzZXJzSW5mb1ticm93c2VySWRdKVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgIHRoaXMubG9jYWxCcm93c2Vyc0luZm9bYnJvd3NlcklkXSA9IHtcbiAgICAgICAgICAgIHdpbmRvd0Rlc2NyaXB0b3I6ICBudWxsLFxuICAgICAgICAgICAgbWF4U2NyZWVuU2l6ZTogICAgIG51bGwsXG4gICAgICAgICAgICByZXNpemVDb3JyZWN0aW9uczogbnVsbFxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHByaXZhdGUgX2dldFdpbmRvd0Rlc2NyaXB0b3IgKGJyb3dzZXJJZDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgICAgIHJldHVybiB0aGlzLmxvY2FsQnJvd3NlcnNJbmZvW2Jyb3dzZXJJZF0gJiYgdGhpcy5sb2NhbEJyb3dzZXJzSW5mb1ticm93c2VySWRdLndpbmRvd0Rlc2NyaXB0b3I7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfZ2V0TWF4U2NyZWVuU2l6ZSAoYnJvd3NlcklkOiBzdHJpbmcpOiBTaXplIHwgbnVsbCB7XG4gICAgICAgIHJldHVybiB0aGlzLmxvY2FsQnJvd3NlcnNJbmZvW2Jyb3dzZXJJZF0gJiYgdGhpcy5sb2NhbEJyb3dzZXJzSW5mb1ticm93c2VySWRdLm1heFNjcmVlblNpemU7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfZ2V0UmVzaXplQ29ycmVjdGlvbnMgKGJyb3dzZXJJZDogc3RyaW5nKTogU2l6ZSB8IG51bGwge1xuICAgICAgICByZXR1cm4gdGhpcy5sb2NhbEJyb3dzZXJzSW5mb1ticm93c2VySWRdICYmIHRoaXMubG9jYWxCcm93c2Vyc0luZm9bYnJvd3NlcklkXS5yZXNpemVDb3JyZWN0aW9ucztcbiAgICB9XG5cbiAgICBwcml2YXRlIF9pc0Jyb3dzZXJJZGxlIChicm93c2VySWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgICAgICBjb25zdCBjb25uZWN0aW9uID0gQnJvd3NlckNvbm5lY3Rpb24uZ2V0QnlJZChicm93c2VySWQpIGFzIEJyb3dzZXJDb25uZWN0aW9uO1xuXG4gICAgICAgIHJldHVybiBjb25uZWN0aW9uLmlkbGU7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBfY2FsY3VsYXRlUmVzaXplQ29ycmVjdGlvbnMgKGJyb3dzZXJJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGlmICghdGhpcy5faXNCcm93c2VySWRsZShicm93c2VySWQpKVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgIGNvbnN0IHRpdGxlID0gYXdhaXQgdGhpcy5wbHVnaW4ucnVuSW5pdFNjcmlwdChicm93c2VySWQsIEdFVF9USVRMRV9TQ1JJUFQpO1xuXG4gICAgICAgIGlmICghYXdhaXQgYnJvd3NlclRvb2xzLmlzTWF4aW1pemVkKHRpdGxlKSlcbiAgICAgICAgICAgIHJldHVybjtcblxuICAgICAgICBjb25zdCBjdXJyZW50U2l6ZSA9IGF3YWl0IHRoaXMucGx1Z2luLnJ1bkluaXRTY3JpcHQoYnJvd3NlcklkLCBHRVRfV0lORE9XX0RJTUVOU0lPTlNfSU5GT19TQ1JJUFQpIGFzIFdpbmRvd0RpbWVudGlvbnNJbmZvO1xuICAgICAgICBjb25zdCBldGFsb25TaXplICA9IHN1YnRyYWN0U2l6ZXMoY3VycmVudFNpemUsIFJFU0laRV9ESUZGX1NJWkUpO1xuXG4gICAgICAgIGF3YWl0IGJyb3dzZXJUb29scy5yZXNpemUodGl0bGUsIGN1cnJlbnRTaXplLndpZHRoLCBjdXJyZW50U2l6ZS5oZWlnaHQsIGV0YWxvblNpemUud2lkdGgsIGV0YWxvblNpemUuaGVpZ2h0KTtcblxuICAgICAgICBsZXQgcmVzaXplZFNpemUgICAgPSBhd2FpdCB0aGlzLnBsdWdpbi5ydW5Jbml0U2NyaXB0KGJyb3dzZXJJZCwgR0VUX1dJTkRPV19ESU1FTlNJT05TX0lORk9fU0NSSVBUKSBhcyBXaW5kb3dEaW1lbnRpb25zSW5mbztcbiAgICAgICAgbGV0IGNvcnJlY3Rpb25TaXplID0gc3VidHJhY3RTaXplcyhyZXNpemVkU2l6ZSwgZXRhbG9uU2l6ZSk7XG5cbiAgICAgICAgYXdhaXQgYnJvd3NlclRvb2xzLnJlc2l6ZSh0aXRsZSwgcmVzaXplZFNpemUud2lkdGgsIHJlc2l6ZWRTaXplLmhlaWdodCwgZXRhbG9uU2l6ZS53aWR0aCwgZXRhbG9uU2l6ZS5oZWlnaHQpO1xuXG4gICAgICAgIHJlc2l6ZWRTaXplID0gYXdhaXQgdGhpcy5wbHVnaW4ucnVuSW5pdFNjcmlwdChicm93c2VySWQsIEdFVF9XSU5ET1dfRElNRU5TSU9OU19JTkZPX1NDUklQVCkgYXMgV2luZG93RGltZW50aW9uc0luZm87XG5cbiAgICAgICAgY29ycmVjdGlvblNpemUgPSBzdW1TaXplcyhjb3JyZWN0aW9uU2l6ZSwgc3VidHJhY3RTaXplcyhyZXNpemVkU2l6ZSwgZXRhbG9uU2l6ZSkpO1xuXG4gICAgICAgIGlmICh0aGlzLmxvY2FsQnJvd3NlcnNJbmZvW2Jyb3dzZXJJZF0pXG4gICAgICAgICAgICB0aGlzLmxvY2FsQnJvd3NlcnNJbmZvW2Jyb3dzZXJJZF0ucmVzaXplQ29ycmVjdGlvbnMgPSBjb3JyZWN0aW9uU2l6ZTtcblxuICAgICAgICBhd2FpdCBicm93c2VyVG9vbHMubWF4aW1pemUodGl0bGUpO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgX2NhbGN1bGF0ZU1hY1NpemVMaW1pdHMgKGJyb3dzZXJJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGlmICghdGhpcy5faXNCcm93c2VySWRsZShicm93c2VySWQpKVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgIGNvbnN0IHNpemVJbmZvID0gYXdhaXQgdGhpcy5wbHVnaW4ucnVuSW5pdFNjcmlwdChicm93c2VySWQsIEdFVF9XSU5ET1dfRElNRU5TSU9OU19JTkZPX1NDUklQVCkgYXMgV2luZG93RGltZW50aW9uc0luZm87XG5cbiAgICAgICAgaWYgKHRoaXMubG9jYWxCcm93c2Vyc0luZm9bYnJvd3NlcklkXSkge1xuICAgICAgICAgICAgdGhpcy5sb2NhbEJyb3dzZXJzSW5mb1ticm93c2VySWRdLm1heFNjcmVlblNpemUgPSB7XG4gICAgICAgICAgICAgICAgd2lkdGg6ICBzaXplSW5mby5hdmFpbGFibGVXaWR0aCAtIChzaXplSW5mby5vdXRlcldpZHRoIC0gc2l6ZUluZm8ud2lkdGgpLFxuICAgICAgICAgICAgICAgIGhlaWdodDogc2l6ZUluZm8uYXZhaWxhYmxlSGVpZ2h0IC0gKHNpemVJbmZvLm91dGVySGVpZ2h0IC0gc2l6ZUluZm8uaGVpZ2h0KVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgX2Vuc3VyZUJyb3dzZXJXaW5kb3dEZXNjcmlwdG9yIChicm93c2VySWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBpZiAodGhpcy5fZ2V0V2luZG93RGVzY3JpcHRvcihicm93c2VySWQpKVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUxvY2FsQnJvd3NlckluZm8oYnJvd3NlcklkKTtcblxuICAgICAgICAvLyBOT1RFOiBkZWxheSB0byBlbnN1cmUgdGhlIHdpbmRvdyBmaW5pc2hlZCB0aGUgb3BlbmluZ1xuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi53YWl0Rm9yQ29ubmVjdGlvblJlYWR5KGJyb3dzZXJJZCk7XG4gICAgICAgIGF3YWl0IGRlbGF5KEJST1dTRVJfT1BFTklOR19ERUxBWSk7XG5cbiAgICAgICAgaWYgKHRoaXMubG9jYWxCcm93c2Vyc0luZm9bYnJvd3NlcklkXSkge1xuICAgICAgICAgICAgY29uc3QgY29ubmVjdGlvbiAgICAgPSBCcm93c2VyQ29ubmVjdGlvbi5nZXRCeUlkKGJyb3dzZXJJZCkgYXMgQnJvd3NlckNvbm5lY3Rpb247XG4gICAgICAgICAgICBsZXQgd2luZG93RGVzY3JpcHRvciA9IG51bGw7XG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgd2luZG93RGVzY3JpcHRvciA9IGF3YWl0IGJyb3dzZXJUb29scy5maW5kV2luZG93KGJyb3dzZXJJZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgICAgLy8gTk9URTogV2UgY2FuIHN1cHByZXNzIHRoZSBlcnJvciBoZXJlIHNpbmNlIHdlIGNhbiBqdXN0IGRpc2FibGUgd2luZG93IG1hbmlwdWxhdGlvbiBmdW5jdGlvbnNcbiAgICAgICAgICAgICAgICAvLyB3aGVuIHdlIGNhbm5vdCBmaW5kIGEgbG9jYWwgd2luZG93IGRlc2NyaXB0b3JcbiAgICAgICAgICAgICAgICBERUJVR19MT0dHRVIoZXJyKTtcbiAgICAgICAgICAgICAgICBjb25uZWN0aW9uLmFkZFdhcm5pbmcoXG4gICAgICAgICAgICAgICAgICAgIFdBUk5JTkdfTUVTU0FHRS5jYW5ub3RGaW5kV2luZG93RGVzY3JpcHRvckVycm9yLFxuICAgICAgICAgICAgICAgICAgICBjb25uZWN0aW9uLmJyb3dzZXJJbmZvLmFsaWFzLFxuICAgICAgICAgICAgICAgICAgICBlcnIubWVzc2FnZVxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRoaXMubG9jYWxCcm93c2Vyc0luZm9bYnJvd3NlcklkXS53aW5kb3dEZXNjcmlwdG9yID0gd2luZG93RGVzY3JpcHRvcjtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgX2Vuc3VyZUJyb3dzZXJXaW5kb3dQYXJhbWV0ZXJzIChicm93c2VySWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBhd2FpdCB0aGlzLl9lbnN1cmVCcm93c2VyV2luZG93RGVzY3JpcHRvcihicm93c2VySWQpO1xuXG4gICAgICAgIGlmIChPUy53aW4gJiYgIXRoaXMuX2dldFJlc2l6ZUNvcnJlY3Rpb25zKGJyb3dzZXJJZCkpXG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9jYWxjdWxhdGVSZXNpemVDb3JyZWN0aW9ucyhicm93c2VySWQpO1xuICAgICAgICBlbHNlIGlmIChPUy5tYWMgJiYgIXRoaXMuX2dldE1heFNjcmVlblNpemUoYnJvd3NlcklkKSlcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuX2NhbGN1bGF0ZU1hY1NpemVMaW1pdHMoYnJvd3NlcklkKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIF9jbG9zZUxvY2FsQnJvd3NlciAoYnJvd3NlcklkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgaWYgKHRoaXMucGx1Z2luLm5lZWRDbGVhblVwQnJvd3NlckluZm8pXG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5jbGVhblVwQnJvd3NlckluZm8oYnJvd3NlcklkKTtcblxuICAgICAgICBjb25zdCB3aW5kb3dEZXNjcmlwdG9yID0gdGhpcy5fZ2V0V2luZG93RGVzY3JpcHRvcihicm93c2VySWQpO1xuXG4gICAgICAgIGF3YWl0IGJyb3dzZXJUb29scy5jbG9zZSh3aW5kb3dEZXNjcmlwdG9yKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIF9yZXNpemVMb2NhbEJyb3dzZXJXaW5kb3cgKGJyb3dzZXJJZDogc3RyaW5nLCB3aWR0aDogbnVtYmVyLCBoZWlnaHQ6IG51bWJlciwgY3VycmVudFdpZHRoOiBudW1iZXIsIGN1cnJlbnRIZWlnaHQ6IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBjb25zdCByZXNpemVDb3JyZWN0aW9ucyA9IHRoaXMuX2dldFJlc2l6ZUNvcnJlY3Rpb25zKGJyb3dzZXJJZCk7XG5cbiAgICAgICAgaWYgKHJlc2l6ZUNvcnJlY3Rpb25zICYmIGF3YWl0IGJyb3dzZXJUb29scy5pc01heGltaXplZCh0aGlzLl9nZXRXaW5kb3dEZXNjcmlwdG9yKGJyb3dzZXJJZCkpKSB7XG4gICAgICAgICAgICB3aWR0aCAtPSByZXNpemVDb3JyZWN0aW9ucy53aWR0aDtcbiAgICAgICAgICAgIGhlaWdodCAtPSByZXNpemVDb3JyZWN0aW9ucy5oZWlnaHQ7XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCBicm93c2VyVG9vbHMucmVzaXplKHRoaXMuX2dldFdpbmRvd0Rlc2NyaXB0b3IoYnJvd3NlcklkKSwgY3VycmVudFdpZHRoLCBjdXJyZW50SGVpZ2h0LCB3aWR0aCwgaGVpZ2h0KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIF90YWtlTG9jYWxCcm93c2VyU2NyZWVuc2hvdCAoYnJvd3NlcklkOiBzdHJpbmcsIHNjcmVlbnNob3RQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgYXdhaXQgYnJvd3NlclRvb2xzLnNjcmVlbnNob3QodGhpcy5fZ2V0V2luZG93RGVzY3JpcHRvcihicm93c2VySWQpLCBzY3JlZW5zaG90UGF0aCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBfY2FuUmVzaXplTG9jYWxCcm93c2VyV2luZG93VG9EaW1lbnNpb25zIChicm93c2VySWQ6IHN0cmluZywgd2lkdGg6IG51bWJlciwgaGVpZ2h0OiBudW1iZXIpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICAgICAgaWYgKCFPUy5tYWMpXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcblxuICAgICAgICBjb25zdCBtYXhTY3JlZW5TaXplID0gdGhpcy5fZ2V0TWF4U2NyZWVuU2l6ZShicm93c2VySWQpIGFzIFNpemU7XG5cbiAgICAgICAgcmV0dXJuIHdpZHRoIDw9IG1heFNjcmVlblNpemUud2lkdGggJiYgaGVpZ2h0IDw9IG1heFNjcmVlblNpemUuaGVpZ2h0O1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgX21heGltaXplTG9jYWxCcm93c2VyV2luZG93IChicm93c2VySWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBhd2FpdCBicm93c2VyVG9vbHMubWF4aW1pemUodGhpcy5fZ2V0V2luZG93RGVzY3JpcHRvcihicm93c2VySWQpKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgYXN5bmMgY2FuVXNlRGVmYXVsdFdpbmRvd0FjdGlvbnMgKGJyb3dzZXJJZDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgICAgIGNvbnN0IGlzTG9jYWxCcm93c2VyICAgID0gYXdhaXQgdGhpcy5wbHVnaW4uaXNMb2NhbEJyb3dzZXIoYnJvd3NlcklkKTtcbiAgICAgICAgY29uc3QgaXNIZWFkbGVzc0Jyb3dzZXIgPSBhd2FpdCB0aGlzLnBsdWdpbi5pc0hlYWRsZXNzQnJvd3Nlcihicm93c2VySWQpO1xuXG4gICAgICAgIHJldHVybiBpc0xvY2FsQnJvd3NlciAmJiAhaXNIZWFkbGVzc0Jyb3dzZXI7XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIGluaXQgKCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBjb25zdCBpbml0aWFsaXplZCA9IGF3YWl0IHRoaXMuaW5pdFByb21pc2U7XG5cbiAgICAgICAgaWYgKGluaXRpYWxpemVkKVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgIHRoaXMuaW5pdFByb21pc2UgPSB0aGlzLnBsdWdpblxuICAgICAgICAgICAgLmluaXQoKVxuICAgICAgICAgICAgLnRoZW4oKCkgPT4gdHJ1ZSk7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuaW5pdFByb21pc2U7XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICB0aGlzLmluaXRQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKGZhbHNlKTtcblxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwdWJsaWMgYXN5bmMgZGlzcG9zZSAoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGNvbnN0IGluaXRpYWxpemVkID0gYXdhaXQgdGhpcy5pbml0UHJvbWlzZTtcblxuICAgICAgICBpZiAoIWluaXRpYWxpemVkKVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgIHRoaXMuaW5pdFByb21pc2UgPSB0aGlzLnBsdWdpblxuICAgICAgICAgICAgLmRpc3Bvc2UoKVxuICAgICAgICAgICAgLnRoZW4oKCkgPT4gZmFsc2UpO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmluaXRQcm9taXNlO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgdGhpcy5pbml0UHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZShmYWxzZSk7XG5cbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIGlzTG9jYWxCcm93c2VyIChicm93c2VySWQ/OiBzdHJpbmcsIGJyb3dzZXJOYW1lPzogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnBsdWdpbi5pc0xvY2FsQnJvd3Nlcihicm93c2VySWQsIGJyb3dzZXJOYW1lKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgaXNIZWFkbGVzc0Jyb3dzZXIgKGJyb3dzZXJJZD86IHN0cmluZywgYnJvd3Nlck5hbWU/OiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMucGx1Z2luLmlzSGVhZGxlc3NCcm93c2VyKGJyb3dzZXJJZCwgYnJvd3Nlck5hbWUpO1xuICAgIH1cblxuICAgIHB1YmxpYyBhc3luYyBvcGVuQnJvd3NlciAoYnJvd3NlcklkOiBzdHJpbmcsIHBhZ2VVcmw6IHN0cmluZywgYnJvd3Nlck5hbWU6IHN0cmluZywgZGlzYWJsZU11bHRpcGxlV2luZG93czogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5vcGVuQnJvd3Nlcihicm93c2VySWQsIHBhZ2VVcmwsIGJyb3dzZXJOYW1lLCBkaXNhYmxlTXVsdGlwbGVXaW5kb3dzKTtcblxuICAgICAgICBpZiAoYXdhaXQgdGhpcy5jYW5Vc2VEZWZhdWx0V2luZG93QWN0aW9ucyhicm93c2VySWQpKVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlQnJvd3NlcldpbmRvd1BhcmFtZXRlcnMoYnJvd3NlcklkKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgYXN5bmMgY2xvc2VCcm93c2VyIChicm93c2VySWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBjb25zdCBjYW5Vc2VEZWZhdWx0V2luZG93QWN0aW9ucyA9IGF3YWl0IHRoaXMuY2FuVXNlRGVmYXVsdFdpbmRvd0FjdGlvbnMoYnJvd3NlcklkKTtcbiAgICAgICAgY29uc3QgY3VzdG9tQWN0aW9uc0luZm8gICAgICAgICAgPSBhd2FpdCB0aGlzLmhhc0N1c3RvbUFjdGlvbkZvckJyb3dzZXIoYnJvd3NlcklkKTtcbiAgICAgICAgY29uc3QgaGFzQ3VzdG9tQ2xvc2VCcm93c2VyICAgICAgPSBjdXN0b21BY3Rpb25zSW5mby5oYXNDbG9zZUJyb3dzZXI7XG4gICAgICAgIGNvbnN0IHVzZVBsdWdpbnNDbG9zZUJyb3dzZXIgICAgID0gaGFzQ3VzdG9tQ2xvc2VCcm93c2VyIHx8ICFjYW5Vc2VEZWZhdWx0V2luZG93QWN0aW9ucztcblxuICAgICAgICBpZiAodXNlUGx1Z2luc0Nsb3NlQnJvd3NlcilcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmNsb3NlQnJvd3Nlcihicm93c2VySWQpO1xuICAgICAgICBlbHNlXG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9jbG9zZUxvY2FsQnJvd3Nlcihicm93c2VySWQpO1xuXG4gICAgICAgIGlmIChjYW5Vc2VEZWZhdWx0V2luZG93QWN0aW9ucylcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmxvY2FsQnJvd3NlcnNJbmZvW2Jyb3dzZXJJZF07XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIGdldEJyb3dzZXJMaXN0ICgpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnBsdWdpbi5nZXRCcm93c2VyTGlzdCgpO1xuICAgIH1cblxuICAgIHB1YmxpYyBhc3luYyBpc1ZhbGlkQnJvd3Nlck5hbWUgKGJyb3dzZXJOYW1lOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucGx1Z2luLmlzVmFsaWRCcm93c2VyTmFtZShicm93c2VyTmFtZSk7XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIHJlc2l6ZVdpbmRvdyAoYnJvd3NlcklkOiBzdHJpbmcsIHdpZHRoOiBudW1iZXIsIGhlaWdodDogbnVtYmVyLCBjdXJyZW50V2lkdGg6IG51bWJlciwgY3VycmVudEhlaWdodDogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGNvbnN0IGNhblVzZURlZmF1bHRXaW5kb3dBY3Rpb25zID0gYXdhaXQgdGhpcy5jYW5Vc2VEZWZhdWx0V2luZG93QWN0aW9ucyhicm93c2VySWQpO1xuICAgICAgICBjb25zdCBjdXN0b21BY3Rpb25zSW5mbyAgICAgICAgICA9IGF3YWl0IHRoaXMuaGFzQ3VzdG9tQWN0aW9uRm9yQnJvd3Nlcihicm93c2VySWQpO1xuICAgICAgICBjb25zdCBoYXNDdXN0b21SZXNpemVXaW5kb3cgICAgICA9IGN1c3RvbUFjdGlvbnNJbmZvLmhhc1Jlc2l6ZVdpbmRvdztcblxuXG4gICAgICAgIGlmIChjYW5Vc2VEZWZhdWx0V2luZG93QWN0aW9ucyAmJiAhaGFzQ3VzdG9tUmVzaXplV2luZG93KSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9yZXNpemVMb2NhbEJyb3dzZXJXaW5kb3coYnJvd3NlcklkLCB3aWR0aCwgaGVpZ2h0LCBjdXJyZW50V2lkdGgsIGN1cnJlbnRIZWlnaHQpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4ucmVzaXplV2luZG93KGJyb3dzZXJJZCwgd2lkdGgsIGhlaWdodCwgY3VycmVudFdpZHRoLCBjdXJyZW50SGVpZ2h0KTtcbiAgICB9XG5cbiAgICBwdWJsaWMgYXN5bmMgY2FuUmVzaXplV2luZG93VG9EaW1lbnNpb25zIChicm93c2VySWQ6IHN0cmluZywgd2lkdGg6IG51bWJlciwgaGVpZ2h0OiBudW1iZXIpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICAgICAgY29uc3QgY2FuVXNlRGVmYXVsdFdpbmRvd0FjdGlvbnMgICAgID0gYXdhaXQgdGhpcy5jYW5Vc2VEZWZhdWx0V2luZG93QWN0aW9ucyhicm93c2VySWQpO1xuICAgICAgICBjb25zdCBjdXN0b21BY3Rpb25zSW5mbyAgICAgICAgICAgICAgPSBhd2FpdCB0aGlzLmhhc0N1c3RvbUFjdGlvbkZvckJyb3dzZXIoYnJvd3NlcklkKTtcbiAgICAgICAgY29uc3QgaGFzQ3VzdG9tQ2FuUmVzaXplVG9EaW1lbnNpb25zID0gY3VzdG9tQWN0aW9uc0luZm8uaGFzQ2FuUmVzaXplV2luZG93VG9EaW1lbnNpb25zO1xuXG5cbiAgICAgICAgaWYgKGNhblVzZURlZmF1bHRXaW5kb3dBY3Rpb25zICYmICFoYXNDdXN0b21DYW5SZXNpemVUb0RpbWVuc2lvbnMpXG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5fY2FuUmVzaXplTG9jYWxCcm93c2VyV2luZG93VG9EaW1lbnNpb25zKGJyb3dzZXJJZCwgd2lkdGgsIGhlaWdodCk7XG5cbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucGx1Z2luLmNhblJlc2l6ZVdpbmRvd1RvRGltZW5zaW9ucyhicm93c2VySWQsIHdpZHRoLCBoZWlnaHQpO1xuICAgIH1cblxuICAgIHB1YmxpYyBhc3luYyBtYXhpbWl6ZVdpbmRvdyAoYnJvd3NlcklkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgY29uc3QgY2FuVXNlRGVmYXVsdFdpbmRvd0FjdGlvbnMgPSBhd2FpdCB0aGlzLmNhblVzZURlZmF1bHRXaW5kb3dBY3Rpb25zKGJyb3dzZXJJZCk7XG4gICAgICAgIGNvbnN0IGN1c3RvbUFjdGlvbnNJbmZvICAgICAgICAgID0gYXdhaXQgdGhpcy5oYXNDdXN0b21BY3Rpb25Gb3JCcm93c2VyKGJyb3dzZXJJZCk7XG4gICAgICAgIGNvbnN0IGhhc0N1c3RvbU1heGltaXplV2luZG93ICAgID0gY3VzdG9tQWN0aW9uc0luZm8uaGFzTWF4aW1pemVXaW5kb3c7XG5cbiAgICAgICAgaWYgKGNhblVzZURlZmF1bHRXaW5kb3dBY3Rpb25zICYmICFoYXNDdXN0b21NYXhpbWl6ZVdpbmRvdylcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9tYXhpbWl6ZUxvY2FsQnJvd3NlcldpbmRvdyhicm93c2VySWQpO1xuXG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnBsdWdpbi5tYXhpbWl6ZVdpbmRvdyhicm93c2VySWQpO1xuICAgIH1cblxuICAgIHB1YmxpYyBhc3luYyB0YWtlU2NyZWVuc2hvdCAoYnJvd3NlcklkOiBzdHJpbmcsIHNjcmVlbnNob3RQYXRoOiBzdHJpbmcsIHBhZ2VXaWR0aDogbnVtYmVyLCBwYWdlSGVpZ2h0OiBudW1iZXIsIGZ1bGxQYWdlOiBib29sZWFuKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGNvbnN0IGNhblVzZURlZmF1bHRXaW5kb3dBY3Rpb25zICA9IGF3YWl0IHRoaXMuY2FuVXNlRGVmYXVsdFdpbmRvd0FjdGlvbnMoYnJvd3NlcklkKTtcbiAgICAgICAgY29uc3QgY3VzdG9tQWN0aW9uc0luZm8gICAgICAgICAgID0gYXdhaXQgdGhpcy5oYXNDdXN0b21BY3Rpb25Gb3JCcm93c2VyKGJyb3dzZXJJZCk7XG4gICAgICAgIGNvbnN0IGhhc0N1c3RvbVRha2VTY3JlZW5zaG90ICAgICA9IGN1c3RvbUFjdGlvbnNJbmZvLmhhc1Rha2VTY3JlZW5zaG90O1xuICAgICAgICBjb25zdCBjb25uZWN0aW9uICAgICAgICAgICAgICAgICAgPSBCcm93c2VyQ29ubmVjdGlvbi5nZXRCeUlkKGJyb3dzZXJJZCkgYXMgQnJvd3NlckNvbm5lY3Rpb247XG4gICAgICAgIGNvbnN0IHRha2VMb2NhbEJyb3dzZXJzU2NyZWVuc2hvdCA9IGNhblVzZURlZmF1bHRXaW5kb3dBY3Rpb25zICYmICFoYXNDdXN0b21UYWtlU2NyZWVuc2hvdDtcbiAgICAgICAgY29uc3QgaXNMb2NhbEZ1bGxQYWdlTW9kZSAgICAgICAgID0gdGFrZUxvY2FsQnJvd3NlcnNTY3JlZW5zaG90ICYmIGZ1bGxQYWdlO1xuXG4gICAgICAgIGlmIChpc0xvY2FsRnVsbFBhZ2VNb2RlKSB7XG4gICAgICAgICAgICBjb25uZWN0aW9uLmFkZFdhcm5pbmcoV0FSTklOR19NRVNTQUdFLnNjcmVlbnNob3RzRnVsbFBhZ2VOb3RTdXBwb3J0ZWQsIGNvbm5lY3Rpb24uYnJvd3NlckluZm8uYWxpYXMpO1xuXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCBtYWtlRGlyKGRpcm5hbWUoc2NyZWVuc2hvdFBhdGgpKTtcblxuICAgICAgICBpZiAodGFrZUxvY2FsQnJvd3NlcnNTY3JlZW5zaG90KVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5fdGFrZUxvY2FsQnJvd3NlclNjcmVlbnNob3QoYnJvd3NlcklkLCBzY3JlZW5zaG90UGF0aCk7XG4gICAgICAgIGVsc2VcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnRha2VTY3JlZW5zaG90KGJyb3dzZXJJZCwgc2NyZWVuc2hvdFBhdGgsIHBhZ2VXaWR0aCwgcGFnZUhlaWdodCwgZnVsbFBhZ2UpO1xuICAgIH1cblxuICAgIHB1YmxpYyBhc3luYyBnZXRWaWRlb0ZyYW1lRGF0YSAoYnJvd3NlcklkOiBzdHJpbmcpOiBQcm9taXNlPGFueT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5wbHVnaW4uZ2V0VmlkZW9GcmFtZURhdGEoYnJvd3NlcklkKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgYXN5bmMgaGFzQ3VzdG9tQWN0aW9uRm9yQnJvd3NlciAoYnJvd3NlcklkOiBzdHJpbmcpOiBQcm9taXNlPGFueT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5wbHVnaW4uaGFzQ3VzdG9tQWN0aW9uRm9yQnJvd3Nlcihicm93c2VySWQpO1xuICAgIH1cblxuICAgIHB1YmxpYyBhc3luYyByZXBvcnRKb2JSZXN1bHQgKGJyb3dzZXJJZDogc3RyaW5nLCBzdGF0dXM6IHN0cmluZywgZGF0YTogYW55KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnJlcG9ydEpvYlJlc3VsdChicm93c2VySWQsIHN0YXR1cywgZGF0YSk7XG4gICAgfVxuXG4gICAgcHVibGljIGdldEFjdGl2ZVdpbmRvd0lkIChicm93c2VySWQ6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICAgICAgICBpZiAoIXRoaXMucGx1Z2luLnN1cHBvcnRNdWx0aXBsZVdpbmRvd3MpXG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcblxuICAgICAgICByZXR1cm4gdGhpcy5wbHVnaW4uZ2V0QWN0aXZlV2luZG93SWQoYnJvd3NlcklkKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgc2V0QWN0aXZlV2luZG93SWQgKGJyb3dzZXJJZDogc3RyaW5nLCB2YWw6IHN0cmluZyk6IHZvaWQge1xuICAgICAgICB0aGlzLnBsdWdpbi5zZXRBY3RpdmVXaW5kb3dJZChicm93c2VySWQsIHZhbCk7XG4gICAgfVxufVxuIl19