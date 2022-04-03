"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const testcafe_browser_tools_1 = require("testcafe-browser-tools");
const get_maximized_headless_window_size_1 = __importDefault(require("../../utils/get-maximized-headless-window-size"));
const crop_1 = require("../../../../screenshots/crop");
const promisified_functions_1 = require("../../../../utils/promisified-functions");
exports.default = {
    openedBrowsers: {},
    isMultiBrowser: false,
    supportMultipleWindows: true,
    getActiveWindowId(browserId) {
        return this.openedBrowsers[browserId].activeWindowId;
    },
    setActiveWindowId(browserId, val) {
        this.openedBrowsers[browserId].activeWindowId = val;
    },
    _getConfig() {
        throw new Error('Not implemented');
    },
    _getBrowserProtocolClient( /* runtimeInfo */) {
        throw new Error('Not implemented');
    },
    _getBrowserName() {
        return this.providerName.replace(':', '');
    },
    async isValidBrowserName(browserName) {
        const config = await this._getConfig(browserName);
        const browserInfo = await testcafe_browser_tools_1.getBrowserInfo(config.path || this._getBrowserName());
        return !!browserInfo;
    },
    async isLocalBrowser() {
        return true;
    },
    isHeadlessBrowser(browserId, browserName) {
        if (browserId)
            return this.openedBrowsers[browserId].config.headless;
        const config = this._getConfig(browserName);
        return !!config.headless;
    },
    _getCropDimensions(viewportWidth, viewportHeight) {
        if (!viewportWidth || !viewportHeight)
            return null;
        return {
            left: 0,
            top: 0,
            right: viewportWidth,
            bottom: viewportHeight
        };
    },
    async takeScreenshot(browserId, path, viewportWidth, viewportHeight, fullPage) {
        const runtimeInfo = this.openedBrowsers[browserId];
        const browserClient = this._getBrowserProtocolClient(runtimeInfo);
        const binaryImage = await browserClient.getScreenshotData(runtimeInfo, fullPage);
        const cropDimensions = this._getCropDimensions(viewportWidth, viewportHeight);
        let pngImage = await promisified_functions_1.readPng(binaryImage);
        if (!fullPage)
            pngImage = await crop_1.cropScreenshot(pngImage, { path, cropDimensions }) || pngImage;
        await promisified_functions_1.writePng(path, pngImage);
    },
    async maximizeWindow(browserId) {
        const maximumSize = get_maximized_headless_window_size_1.default();
        await this.resizeWindow(browserId, maximumSize.width, maximumSize.height, maximumSize.width, maximumSize.height);
    }
};
module.exports = exports.default;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9icm93c2VyL3Byb3ZpZGVyL2J1aWx0LWluL2RlZGljYXRlZC9iYXNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBQUEsbUVBQXdEO0FBQ3hELHdIQUE0RjtBQUM1Rix1REFBOEQ7QUFDOUQsbUZBQTRFO0FBRTVFLGtCQUFlO0lBQ1gsY0FBYyxFQUFFLEVBQUU7SUFFbEIsY0FBYyxFQUFFLEtBQUs7SUFFckIsc0JBQXNCLEVBQUUsSUFBSTtJQUU1QixpQkFBaUIsQ0FBRSxTQUFTO1FBQ3hCLE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxjQUFjLENBQUM7SUFDekQsQ0FBQztJQUVELGlCQUFpQixDQUFFLFNBQVMsRUFBRSxHQUFHO1FBQzdCLElBQUksQ0FBQyxjQUFjLENBQUMsU0FBUyxDQUFDLENBQUMsY0FBYyxHQUFHLEdBQUcsQ0FBQztJQUN4RCxDQUFDO0lBRUQsVUFBVTtRQUNOLE1BQU0sSUFBSSxLQUFLLENBQUMsaUJBQWlCLENBQUMsQ0FBQztJQUN2QyxDQUFDO0lBRUQseUJBQXlCLEVBQUUsaUJBQWlCO1FBQ3hDLE1BQU0sSUFBSSxLQUFLLENBQUMsaUJBQWlCLENBQUMsQ0FBQztJQUN2QyxDQUFDO0lBRUQsZUFBZTtRQUNYLE9BQU8sSUFBSSxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxDQUFDO0lBQzlDLENBQUM7SUFFRCxLQUFLLENBQUMsa0JBQWtCLENBQUUsV0FBVztRQUNqQyxNQUFNLE1BQU0sR0FBUSxNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsV0FBVyxDQUFDLENBQUM7UUFDdkQsTUFBTSxXQUFXLEdBQUcsTUFBTSx1Q0FBYyxDQUFDLE1BQU0sQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDLENBQUM7UUFFaEYsT0FBTyxDQUFDLENBQUMsV0FBVyxDQUFDO0lBQ3pCLENBQUM7SUFFRCxLQUFLLENBQUMsY0FBYztRQUNoQixPQUFPLElBQUksQ0FBQztJQUNoQixDQUFDO0lBRUQsaUJBQWlCLENBQUUsU0FBUyxFQUFFLFdBQVc7UUFDckMsSUFBSSxTQUFTO1lBQ1QsT0FBTyxJQUFJLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUM7UUFFMUQsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUU1QyxPQUFPLENBQUMsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDO0lBQzdCLENBQUM7SUFFRCxrQkFBa0IsQ0FBRSxhQUFhLEVBQUUsY0FBYztRQUM3QyxJQUFJLENBQUMsYUFBYSxJQUFJLENBQUMsY0FBYztZQUNqQyxPQUFPLElBQUksQ0FBQztRQUVoQixPQUFPO1lBQ0gsSUFBSSxFQUFJLENBQUM7WUFDVCxHQUFHLEVBQUssQ0FBQztZQUNULEtBQUssRUFBRyxhQUFhO1lBQ3JCLE1BQU0sRUFBRSxjQUFjO1NBQ3pCLENBQUM7SUFDTixDQUFDO0lBRUQsS0FBSyxDQUFDLGNBQWMsQ0FBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLGFBQWEsRUFBRSxjQUFjLEVBQUUsUUFBUTtRQUMxRSxNQUFNLFdBQVcsR0FBTSxJQUFJLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQ3RELE1BQU0sYUFBYSxHQUFJLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUNuRSxNQUFNLFdBQVcsR0FBTSxNQUFNLGFBQWEsQ0FBQyxpQkFBaUIsQ0FBQyxXQUFXLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFDcEYsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLGtCQUFrQixDQUFDLGFBQWEsRUFBRSxjQUFjLENBQUMsQ0FBQztRQUU5RSxJQUFJLFFBQVEsR0FBRyxNQUFNLCtCQUFPLENBQUMsV0FBVyxDQUFDLENBQUM7UUFFMUMsSUFBSSxDQUFDLFFBQVE7WUFDVCxRQUFRLEdBQUcsTUFBTSxxQkFBYyxDQUFDLFFBQVEsRUFBRSxFQUFFLElBQUksRUFBRSxjQUFjLEVBQUUsQ0FBQyxJQUFJLFFBQVEsQ0FBQztRQUVwRixNQUFNLGdDQUFRLENBQUMsSUFBSSxFQUFFLFFBQVEsQ0FBQyxDQUFDO0lBQ25DLENBQUM7SUFFRCxLQUFLLENBQUMsY0FBYyxDQUFFLFNBQVM7UUFDM0IsTUFBTSxXQUFXLEdBQUcsNENBQThCLEVBQUUsQ0FBQztRQUVyRCxNQUFNLElBQUksQ0FBQyxZQUFZLENBQUMsU0FBUyxFQUFFLFdBQVcsQ0FBQyxLQUFLLEVBQUUsV0FBVyxDQUFDLE1BQU0sRUFBRSxXQUFXLENBQUMsS0FBSyxFQUFFLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUNySCxDQUFDO0NBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGdldEJyb3dzZXJJbmZvIH0gZnJvbSAndGVzdGNhZmUtYnJvd3Nlci10b29scyc7XG5pbXBvcnQgZ2V0TWF4aW1pemVkSGVhZGxlc3NXaW5kb3dTaXplIGZyb20gJy4uLy4uL3V0aWxzL2dldC1tYXhpbWl6ZWQtaGVhZGxlc3Mtd2luZG93LXNpemUnO1xuaW1wb3J0IHsgY3JvcFNjcmVlbnNob3QgfSBmcm9tICcuLi8uLi8uLi8uLi9zY3JlZW5zaG90cy9jcm9wJztcbmltcG9ydCB7IHJlYWRQbmcsIHdyaXRlUG5nIH0gZnJvbSAnLi4vLi4vLi4vLi4vdXRpbHMvcHJvbWlzaWZpZWQtZnVuY3Rpb25zJztcblxuZXhwb3J0IGRlZmF1bHQge1xuICAgIG9wZW5lZEJyb3dzZXJzOiB7fSxcblxuICAgIGlzTXVsdGlCcm93c2VyOiBmYWxzZSxcblxuICAgIHN1cHBvcnRNdWx0aXBsZVdpbmRvd3M6IHRydWUsXG5cbiAgICBnZXRBY3RpdmVXaW5kb3dJZCAoYnJvd3NlcklkKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm9wZW5lZEJyb3dzZXJzW2Jyb3dzZXJJZF0uYWN0aXZlV2luZG93SWQ7XG4gICAgfSxcblxuICAgIHNldEFjdGl2ZVdpbmRvd0lkIChicm93c2VySWQsIHZhbCkge1xuICAgICAgICB0aGlzLm9wZW5lZEJyb3dzZXJzW2Jyb3dzZXJJZF0uYWN0aXZlV2luZG93SWQgPSB2YWw7XG4gICAgfSxcblxuICAgIF9nZXRDb25maWcgKCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vdCBpbXBsZW1lbnRlZCcpO1xuICAgIH0sXG5cbiAgICBfZ2V0QnJvd3NlclByb3RvY29sQ2xpZW50ICgvKiBydW50aW1lSW5mbyAqLykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vdCBpbXBsZW1lbnRlZCcpO1xuICAgIH0sXG5cbiAgICBfZ2V0QnJvd3Nlck5hbWUgKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5wcm92aWRlck5hbWUucmVwbGFjZSgnOicsICcnKTtcbiAgICB9LFxuXG4gICAgYXN5bmMgaXNWYWxpZEJyb3dzZXJOYW1lIChicm93c2VyTmFtZSkge1xuICAgICAgICBjb25zdCBjb25maWcgICAgICA9IGF3YWl0IHRoaXMuX2dldENvbmZpZyhicm93c2VyTmFtZSk7XG4gICAgICAgIGNvbnN0IGJyb3dzZXJJbmZvID0gYXdhaXQgZ2V0QnJvd3NlckluZm8oY29uZmlnLnBhdGggfHwgdGhpcy5fZ2V0QnJvd3Nlck5hbWUoKSk7XG5cbiAgICAgICAgcmV0dXJuICEhYnJvd3NlckluZm87XG4gICAgfSxcblxuICAgIGFzeW5jIGlzTG9jYWxCcm93c2VyICgpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSxcblxuICAgIGlzSGVhZGxlc3NCcm93c2VyIChicm93c2VySWQsIGJyb3dzZXJOYW1lKSB7XG4gICAgICAgIGlmIChicm93c2VySWQpXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5vcGVuZWRCcm93c2Vyc1ticm93c2VySWRdLmNvbmZpZy5oZWFkbGVzcztcblxuICAgICAgICBjb25zdCBjb25maWcgPSB0aGlzLl9nZXRDb25maWcoYnJvd3Nlck5hbWUpO1xuXG4gICAgICAgIHJldHVybiAhIWNvbmZpZy5oZWFkbGVzcztcbiAgICB9LFxuXG4gICAgX2dldENyb3BEaW1lbnNpb25zICh2aWV3cG9ydFdpZHRoLCB2aWV3cG9ydEhlaWdodCkge1xuICAgICAgICBpZiAoIXZpZXdwb3J0V2lkdGggfHwgIXZpZXdwb3J0SGVpZ2h0KVxuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGxlZnQ6ICAgMCxcbiAgICAgICAgICAgIHRvcDogICAgMCxcbiAgICAgICAgICAgIHJpZ2h0OiAgdmlld3BvcnRXaWR0aCxcbiAgICAgICAgICAgIGJvdHRvbTogdmlld3BvcnRIZWlnaHRcbiAgICAgICAgfTtcbiAgICB9LFxuXG4gICAgYXN5bmMgdGFrZVNjcmVlbnNob3QgKGJyb3dzZXJJZCwgcGF0aCwgdmlld3BvcnRXaWR0aCwgdmlld3BvcnRIZWlnaHQsIGZ1bGxQYWdlKSB7XG4gICAgICAgIGNvbnN0IHJ1bnRpbWVJbmZvICAgID0gdGhpcy5vcGVuZWRCcm93c2Vyc1ticm93c2VySWRdO1xuICAgICAgICBjb25zdCBicm93c2VyQ2xpZW50ICA9IHRoaXMuX2dldEJyb3dzZXJQcm90b2NvbENsaWVudChydW50aW1lSW5mbyk7XG4gICAgICAgIGNvbnN0IGJpbmFyeUltYWdlICAgID0gYXdhaXQgYnJvd3NlckNsaWVudC5nZXRTY3JlZW5zaG90RGF0YShydW50aW1lSW5mbywgZnVsbFBhZ2UpO1xuICAgICAgICBjb25zdCBjcm9wRGltZW5zaW9ucyA9IHRoaXMuX2dldENyb3BEaW1lbnNpb25zKHZpZXdwb3J0V2lkdGgsIHZpZXdwb3J0SGVpZ2h0KTtcblxuICAgICAgICBsZXQgcG5nSW1hZ2UgPSBhd2FpdCByZWFkUG5nKGJpbmFyeUltYWdlKTtcblxuICAgICAgICBpZiAoIWZ1bGxQYWdlKVxuICAgICAgICAgICAgcG5nSW1hZ2UgPSBhd2FpdCBjcm9wU2NyZWVuc2hvdChwbmdJbWFnZSwgeyBwYXRoLCBjcm9wRGltZW5zaW9ucyB9KSB8fCBwbmdJbWFnZTtcblxuICAgICAgICBhd2FpdCB3cml0ZVBuZyhwYXRoLCBwbmdJbWFnZSk7XG4gICAgfSxcblxuICAgIGFzeW5jIG1heGltaXplV2luZG93IChicm93c2VySWQpIHtcbiAgICAgICAgY29uc3QgbWF4aW11bVNpemUgPSBnZXRNYXhpbWl6ZWRIZWFkbGVzc1dpbmRvd1NpemUoKTtcblxuICAgICAgICBhd2FpdCB0aGlzLnJlc2l6ZVdpbmRvdyhicm93c2VySWQsIG1heGltdW1TaXplLndpZHRoLCBtYXhpbXVtU2l6ZS5oZWlnaHQsIG1heGltdW1TaXplLndpZHRoLCBtYXhpbXVtU2l6ZS5oZWlnaHQpO1xuICAgIH1cbn07XG4iXX0=