"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const os_family_1 = __importDefault(require("os-family"));
const url_1 = require("url");
const base_1 = __importDefault(require("../base"));
const runtime_info_1 = __importDefault(require("./runtime-info"));
const config_1 = __importDefault(require("./config"));
const local_chrome_1 = require("./local-chrome");
const cdp = __importStar(require("./cdp"));
const client_functions_1 = require("../../../utils/client-functions");
const MIN_AVAILABLE_DIMENSION = 50;
exports.default = Object.assign(Object.assign({}, base_1.default), { _getConfig(name) {
        return config_1.default(name);
    },
    _getBrowserProtocolClient() {
        return cdp;
    },
    async _createRunTimeInfo(hostName, configString, disableMultipleWindows) {
        return runtime_info_1.default.create(hostName, configString, disableMultipleWindows);
    },
    _setUserAgentMetaInfoForEmulatingDevice(browserId, config) {
        const { emulation, deviceName } = config;
        const isDeviceEmulation = emulation && deviceName;
        if (!isDeviceEmulation)
            return;
        const metaInfo = `Emulating ${deviceName}`;
        const options = {
            appendToUserAgent: true
        };
        this.setUserAgentMetaInfo(browserId, metaInfo, options);
    },
    async openBrowser(browserId, pageUrl, configString, disableMultipleWindows) {
        const parsedPageUrl = url_1.parse(pageUrl);
        const runtimeInfo = await this._createRunTimeInfo(parsedPageUrl.hostname, configString, disableMultipleWindows);
        runtimeInfo.browserName = this._getBrowserName();
        runtimeInfo.browserId = browserId;
        runtimeInfo.providerMethods = {
            resizeLocalBrowserWindow: (...args) => this.resizeLocalBrowserWindow(...args)
        };
        await local_chrome_1.start(pageUrl, runtimeInfo);
        await this.waitForConnectionReady(browserId);
        runtimeInfo.viewportSize = await this.runInitScript(browserId, client_functions_1.GET_WINDOW_DIMENSIONS_INFO_SCRIPT);
        runtimeInfo.activeWindowId = null;
        if (!disableMultipleWindows)
            runtimeInfo.activeWindowId = this.calculateWindowId();
        await cdp.createClient(runtimeInfo);
        this.openedBrowsers[browserId] = runtimeInfo;
        await this._ensureWindowIsExpanded(browserId, runtimeInfo.viewportSize);
        this._setUserAgentMetaInfoForEmulatingDevice(browserId, runtimeInfo.config);
    },
    async closeBrowser(browserId) {
        const runtimeInfo = this.openedBrowsers[browserId];
        if (cdp.isHeadlessTab(runtimeInfo))
            await cdp.closeTab(runtimeInfo);
        else
            await this.closeLocalBrowser(browserId);
        if (os_family_1.default.mac || runtimeInfo.config.headless)
            await local_chrome_1.stop(runtimeInfo);
        if (runtimeInfo.tempProfileDir)
            await runtimeInfo.tempProfileDir.dispose();
        delete this.openedBrowsers[browserId];
    },
    async resizeWindow(browserId, width, height, currentWidth, currentHeight) {
        const runtimeInfo = this.openedBrowsers[browserId];
        if (runtimeInfo.config.mobile)
            await cdp.updateMobileViewportSize(runtimeInfo);
        else {
            runtimeInfo.viewportSize.width = currentWidth;
            runtimeInfo.viewportSize.height = currentHeight;
        }
        await cdp.resizeWindow({ width, height }, runtimeInfo);
    },
    async getVideoFrameData(browserId) {
        return await cdp.getScreenshotData(this.openedBrowsers[browserId]);
    },
    async hasCustomActionForBrowser(browserId) {
        const { config, client } = this.openedBrowsers[browserId];
        return {
            hasCloseBrowser: true,
            hasResizeWindow: !!client && (config.emulation || config.headless),
            hasMaximizeWindow: !!client && config.headless,
            hasTakeScreenshot: !!client,
            hasChromelessScreenshots: !!client,
            hasGetVideoFrameData: !!client,
            hasCanResizeWindowToDimensions: false
        };
    },
    async _ensureWindowIsExpanded(browserId, { height, width, availableHeight, availableWidth, outerWidth, outerHeight }) {
        if (height < MIN_AVAILABLE_DIMENSION || width < MIN_AVAILABLE_DIMENSION) {
            const newHeight = Math.max(availableHeight, MIN_AVAILABLE_DIMENSION);
            const newWidth = Math.max(Math.floor(availableWidth / 2), MIN_AVAILABLE_DIMENSION);
            await this.resizeWindow(browserId, newWidth, newHeight, outerWidth, outerHeight);
        }
    } });
module.exports = exports.default;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi9zcmMvYnJvd3Nlci9wcm92aWRlci9idWlsdC1pbi9kZWRpY2F0ZWQvY2hyb21lL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLDBEQUEyQjtBQUMzQiw2QkFBd0M7QUFDeEMsbURBQTRDO0FBQzVDLGtFQUErQztBQUMvQyxzREFBaUM7QUFDakMsaURBQW9GO0FBQ3BGLDJDQUE2QjtBQUM3QixzRUFBb0Y7QUFFcEYsTUFBTSx1QkFBdUIsR0FBRyxFQUFFLENBQUM7QUFFbkMsa0RBQ08sY0FBcUIsS0FFeEIsVUFBVSxDQUFFLElBQUk7UUFDWixPQUFPLGdCQUFTLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDM0IsQ0FBQztJQUVELHlCQUF5QjtRQUNyQixPQUFPLEdBQUcsQ0FBQztJQUNmLENBQUM7SUFFRCxLQUFLLENBQUMsa0JBQWtCLENBQUUsUUFBUSxFQUFFLFlBQVksRUFBRSxzQkFBc0I7UUFDcEUsT0FBTyxzQkFBaUIsQ0FBQyxNQUFNLENBQUMsUUFBUSxFQUFFLFlBQVksRUFBRSxzQkFBc0IsQ0FBQyxDQUFDO0lBQ3BGLENBQUM7SUFFRCx1Q0FBdUMsQ0FBRSxTQUFTLEVBQUUsTUFBTTtRQUN0RCxNQUFNLEVBQUUsU0FBUyxFQUFFLFVBQVUsRUFBRSxHQUFHLE1BQU0sQ0FBQztRQUN6QyxNQUFNLGlCQUFpQixHQUFXLFNBQVMsSUFBSSxVQUFVLENBQUM7UUFFMUQsSUFBSSxDQUFDLGlCQUFpQjtZQUNsQixPQUFPO1FBRVgsTUFBTSxRQUFRLEdBQUcsYUFBYSxVQUFVLEVBQUUsQ0FBQztRQUMzQyxNQUFNLE9BQU8sR0FBSTtZQUNiLGlCQUFpQixFQUFFLElBQUk7U0FDMUIsQ0FBQztRQUVGLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxTQUFTLEVBQUUsUUFBUSxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQzVELENBQUM7SUFFRCxLQUFLLENBQUMsV0FBVyxDQUFFLFNBQVMsRUFBRSxPQUFPLEVBQUUsWUFBWSxFQUFFLHNCQUFzQjtRQUN2RSxNQUFNLGFBQWEsR0FBRyxXQUFRLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDeEMsTUFBTSxXQUFXLEdBQUssTUFBTSxJQUFJLENBQUMsa0JBQWtCLENBQUMsYUFBYSxDQUFDLFFBQVEsRUFBRSxZQUFZLEVBQUUsc0JBQXNCLENBQUMsQ0FBQztRQUVsSCxXQUFXLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztRQUNqRCxXQUFXLENBQUMsU0FBUyxHQUFLLFNBQVMsQ0FBQztRQUVwQyxXQUFXLENBQUMsZUFBZSxHQUFHO1lBQzFCLHdCQUF3QixFQUFFLENBQUMsR0FBRyxJQUFJLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxHQUFHLElBQUksQ0FBQztTQUNoRixDQUFDO1FBRUYsTUFBTSxvQkFBZ0IsQ0FBQyxPQUFPLEVBQUUsV0FBVyxDQUFDLENBQUM7UUFFN0MsTUFBTSxJQUFJLENBQUMsc0JBQXNCLENBQUMsU0FBUyxDQUFDLENBQUM7UUFFN0MsV0FBVyxDQUFDLFlBQVksR0FBSyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsU0FBUyxFQUFFLG9EQUFpQyxDQUFDLENBQUM7UUFDcEcsV0FBVyxDQUFDLGNBQWMsR0FBRyxJQUFJLENBQUM7UUFFbEMsSUFBSSxDQUFDLHNCQUFzQjtZQUN2QixXQUFXLENBQUMsY0FBYyxHQUFHLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1FBRTFELE1BQU0sR0FBRyxDQUFDLFlBQVksQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUVwQyxJQUFJLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQyxHQUFHLFdBQVcsQ0FBQztRQUU3QyxNQUFNLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxTQUFTLEVBQUUsV0FBVyxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBRXhFLElBQUksQ0FBQyx1Q0FBdUMsQ0FBQyxTQUFTLEVBQUUsV0FBVyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQ2hGLENBQUM7SUFFRCxLQUFLLENBQUMsWUFBWSxDQUFFLFNBQVM7UUFDekIsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUVuRCxJQUFJLEdBQUcsQ0FBQyxhQUFhLENBQUMsV0FBVyxDQUFDO1lBQzlCLE1BQU0sR0FBRyxDQUFDLFFBQVEsQ0FBQyxXQUFXLENBQUMsQ0FBQzs7WUFFaEMsTUFBTSxJQUFJLENBQUMsaUJBQWlCLENBQUMsU0FBUyxDQUFDLENBQUM7UUFFNUMsSUFBSSxtQkFBRSxDQUFDLEdBQUcsSUFBSSxXQUFXLENBQUMsTUFBTSxDQUFDLFFBQVE7WUFDckMsTUFBTSxtQkFBZSxDQUFDLFdBQVcsQ0FBQyxDQUFDO1FBRXZDLElBQUksV0FBVyxDQUFDLGNBQWM7WUFDMUIsTUFBTSxXQUFXLENBQUMsY0FBYyxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBRS9DLE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUMxQyxDQUFDO0lBRUQsS0FBSyxDQUFDLFlBQVksQ0FBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsYUFBYTtRQUNyRSxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBRW5ELElBQUksV0FBVyxDQUFDLE1BQU0sQ0FBQyxNQUFNO1lBQ3pCLE1BQU0sR0FBRyxDQUFDLHdCQUF3QixDQUFDLFdBQVcsQ0FBQyxDQUFDO2FBQy9DO1lBQ0QsV0FBVyxDQUFDLFlBQVksQ0FBQyxLQUFLLEdBQUksWUFBWSxDQUFDO1lBQy9DLFdBQVcsQ0FBQyxZQUFZLENBQUMsTUFBTSxHQUFHLGFBQWEsQ0FBQztTQUNuRDtRQUVELE1BQU0sR0FBRyxDQUFDLFlBQVksQ0FBQyxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsRUFBRSxXQUFXLENBQUMsQ0FBQztJQUMzRCxDQUFDO0lBRUQsS0FBSyxDQUFDLGlCQUFpQixDQUFFLFNBQVM7UUFDOUIsT0FBTyxNQUFNLEdBQUcsQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUM7SUFDdkUsQ0FBQztJQUVELEtBQUssQ0FBQyx5QkFBeUIsQ0FBRSxTQUFTO1FBQ3RDLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUUxRCxPQUFPO1lBQ0gsZUFBZSxFQUFpQixJQUFJO1lBQ3BDLGVBQWUsRUFBaUIsQ0FBQyxDQUFDLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQztZQUNqRixpQkFBaUIsRUFBZSxDQUFDLENBQUMsTUFBTSxJQUFJLE1BQU0sQ0FBQyxRQUFRO1lBQzNELGlCQUFpQixFQUFlLENBQUMsQ0FBQyxNQUFNO1lBQ3hDLHdCQUF3QixFQUFRLENBQUMsQ0FBQyxNQUFNO1lBQ3hDLG9CQUFvQixFQUFZLENBQUMsQ0FBQyxNQUFNO1lBQ3hDLDhCQUE4QixFQUFFLEtBQUs7U0FDeEMsQ0FBQztJQUNOLENBQUM7SUFFRCxLQUFLLENBQUMsdUJBQXVCLENBQUUsU0FBUyxFQUFFLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUUsY0FBYyxFQUFFLFVBQVUsRUFBRSxXQUFXLEVBQUU7UUFDakgsSUFBSSxNQUFNLEdBQUcsdUJBQXVCLElBQUksS0FBSyxHQUFHLHVCQUF1QixFQUFFO1lBQ3JFLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsZUFBZSxFQUFFLHVCQUF1QixDQUFDLENBQUM7WUFDckUsTUFBTSxRQUFRLEdBQUksSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLGNBQWMsR0FBRyxDQUFDLENBQUMsRUFBRSx1QkFBdUIsQ0FBQyxDQUFDO1lBRXBGLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxTQUFTLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxVQUFVLEVBQUUsV0FBVyxDQUFDLENBQUM7U0FDcEY7SUFDTCxDQUFDLElBQ0giLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgT1MgZnJvbSAnb3MtZmFtaWx5JztcbmltcG9ydCB7IHBhcnNlIGFzIHBhcnNlVXJsIH0gZnJvbSAndXJsJztcbmltcG9ydCBkZWRpY2F0ZWRQcm92aWRlckJhc2UgZnJvbSAnLi4vYmFzZSc7XG5pbXBvcnQgQ2hyb21lUnVuVGltZUluZm8gZnJvbSAnLi9ydW50aW1lLWluZm8nO1xuaW1wb3J0IGdldENvbmZpZyBmcm9tICcuL2NvbmZpZyc7XG5pbXBvcnQgeyBzdGFydCBhcyBzdGFydExvY2FsQ2hyb21lLCBzdG9wIGFzIHN0b3BMb2NhbENocm9tZSB9IGZyb20gJy4vbG9jYWwtY2hyb21lJztcbmltcG9ydCAqIGFzIGNkcCBmcm9tICcuL2NkcCc7XG5pbXBvcnQgeyBHRVRfV0lORE9XX0RJTUVOU0lPTlNfSU5GT19TQ1JJUFQgfSBmcm9tICcuLi8uLi8uLi91dGlscy9jbGllbnQtZnVuY3Rpb25zJztcblxuY29uc3QgTUlOX0FWQUlMQUJMRV9ESU1FTlNJT04gPSA1MDtcblxuZXhwb3J0IGRlZmF1bHQge1xuICAgIC4uLmRlZGljYXRlZFByb3ZpZGVyQmFzZSxcblxuICAgIF9nZXRDb25maWcgKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIGdldENvbmZpZyhuYW1lKTtcbiAgICB9LFxuXG4gICAgX2dldEJyb3dzZXJQcm90b2NvbENsaWVudCAoKSB7XG4gICAgICAgIHJldHVybiBjZHA7XG4gICAgfSxcblxuICAgIGFzeW5jIF9jcmVhdGVSdW5UaW1lSW5mbyAoaG9zdE5hbWUsIGNvbmZpZ1N0cmluZywgZGlzYWJsZU11bHRpcGxlV2luZG93cykge1xuICAgICAgICByZXR1cm4gQ2hyb21lUnVuVGltZUluZm8uY3JlYXRlKGhvc3ROYW1lLCBjb25maWdTdHJpbmcsIGRpc2FibGVNdWx0aXBsZVdpbmRvd3MpO1xuICAgIH0sXG5cbiAgICBfc2V0VXNlckFnZW50TWV0YUluZm9Gb3JFbXVsYXRpbmdEZXZpY2UgKGJyb3dzZXJJZCwgY29uZmlnKSB7XG4gICAgICAgIGNvbnN0IHsgZW11bGF0aW9uLCBkZXZpY2VOYW1lIH0gPSBjb25maWc7XG4gICAgICAgIGNvbnN0IGlzRGV2aWNlRW11bGF0aW9uICAgICAgICAgPSBlbXVsYXRpb24gJiYgZGV2aWNlTmFtZTtcblxuICAgICAgICBpZiAoIWlzRGV2aWNlRW11bGF0aW9uKVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgIGNvbnN0IG1ldGFJbmZvID0gYEVtdWxhdGluZyAke2RldmljZU5hbWV9YDtcbiAgICAgICAgY29uc3Qgb3B0aW9ucyAgPSB7XG4gICAgICAgICAgICBhcHBlbmRUb1VzZXJBZ2VudDogdHJ1ZVxuICAgICAgICB9O1xuXG4gICAgICAgIHRoaXMuc2V0VXNlckFnZW50TWV0YUluZm8oYnJvd3NlcklkLCBtZXRhSW5mbywgb3B0aW9ucyk7XG4gICAgfSxcblxuICAgIGFzeW5jIG9wZW5Ccm93c2VyIChicm93c2VySWQsIHBhZ2VVcmwsIGNvbmZpZ1N0cmluZywgZGlzYWJsZU11bHRpcGxlV2luZG93cykge1xuICAgICAgICBjb25zdCBwYXJzZWRQYWdlVXJsID0gcGFyc2VVcmwocGFnZVVybCk7XG4gICAgICAgIGNvbnN0IHJ1bnRpbWVJbmZvICAgPSBhd2FpdCB0aGlzLl9jcmVhdGVSdW5UaW1lSW5mbyhwYXJzZWRQYWdlVXJsLmhvc3RuYW1lLCBjb25maWdTdHJpbmcsIGRpc2FibGVNdWx0aXBsZVdpbmRvd3MpO1xuXG4gICAgICAgIHJ1bnRpbWVJbmZvLmJyb3dzZXJOYW1lID0gdGhpcy5fZ2V0QnJvd3Nlck5hbWUoKTtcbiAgICAgICAgcnVudGltZUluZm8uYnJvd3NlcklkICAgPSBicm93c2VySWQ7XG5cbiAgICAgICAgcnVudGltZUluZm8ucHJvdmlkZXJNZXRob2RzID0ge1xuICAgICAgICAgICAgcmVzaXplTG9jYWxCcm93c2VyV2luZG93OiAoLi4uYXJncykgPT4gdGhpcy5yZXNpemVMb2NhbEJyb3dzZXJXaW5kb3coLi4uYXJncylcbiAgICAgICAgfTtcblxuICAgICAgICBhd2FpdCBzdGFydExvY2FsQ2hyb21lKHBhZ2VVcmwsIHJ1bnRpbWVJbmZvKTtcblxuICAgICAgICBhd2FpdCB0aGlzLndhaXRGb3JDb25uZWN0aW9uUmVhZHkoYnJvd3NlcklkKTtcblxuICAgICAgICBydW50aW1lSW5mby52aWV3cG9ydFNpemUgICA9IGF3YWl0IHRoaXMucnVuSW5pdFNjcmlwdChicm93c2VySWQsIEdFVF9XSU5ET1dfRElNRU5TSU9OU19JTkZPX1NDUklQVCk7XG4gICAgICAgIHJ1bnRpbWVJbmZvLmFjdGl2ZVdpbmRvd0lkID0gbnVsbDtcblxuICAgICAgICBpZiAoIWRpc2FibGVNdWx0aXBsZVdpbmRvd3MpXG4gICAgICAgICAgICBydW50aW1lSW5mby5hY3RpdmVXaW5kb3dJZCA9IHRoaXMuY2FsY3VsYXRlV2luZG93SWQoKTtcblxuICAgICAgICBhd2FpdCBjZHAuY3JlYXRlQ2xpZW50KHJ1bnRpbWVJbmZvKTtcblxuICAgICAgICB0aGlzLm9wZW5lZEJyb3dzZXJzW2Jyb3dzZXJJZF0gPSBydW50aW1lSW5mbztcblxuICAgICAgICBhd2FpdCB0aGlzLl9lbnN1cmVXaW5kb3dJc0V4cGFuZGVkKGJyb3dzZXJJZCwgcnVudGltZUluZm8udmlld3BvcnRTaXplKTtcblxuICAgICAgICB0aGlzLl9zZXRVc2VyQWdlbnRNZXRhSW5mb0ZvckVtdWxhdGluZ0RldmljZShicm93c2VySWQsIHJ1bnRpbWVJbmZvLmNvbmZpZyk7XG4gICAgfSxcblxuICAgIGFzeW5jIGNsb3NlQnJvd3NlciAoYnJvd3NlcklkKSB7XG4gICAgICAgIGNvbnN0IHJ1bnRpbWVJbmZvID0gdGhpcy5vcGVuZWRCcm93c2Vyc1ticm93c2VySWRdO1xuXG4gICAgICAgIGlmIChjZHAuaXNIZWFkbGVzc1RhYihydW50aW1lSW5mbykpXG4gICAgICAgICAgICBhd2FpdCBjZHAuY2xvc2VUYWIocnVudGltZUluZm8pO1xuICAgICAgICBlbHNlXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmNsb3NlTG9jYWxCcm93c2VyKGJyb3dzZXJJZCk7XG5cbiAgICAgICAgaWYgKE9TLm1hYyB8fCBydW50aW1lSW5mby5jb25maWcuaGVhZGxlc3MpXG4gICAgICAgICAgICBhd2FpdCBzdG9wTG9jYWxDaHJvbWUocnVudGltZUluZm8pO1xuXG4gICAgICAgIGlmIChydW50aW1lSW5mby50ZW1wUHJvZmlsZURpcilcbiAgICAgICAgICAgIGF3YWl0IHJ1bnRpbWVJbmZvLnRlbXBQcm9maWxlRGlyLmRpc3Bvc2UoKTtcblxuICAgICAgICBkZWxldGUgdGhpcy5vcGVuZWRCcm93c2Vyc1ticm93c2VySWRdO1xuICAgIH0sXG5cbiAgICBhc3luYyByZXNpemVXaW5kb3cgKGJyb3dzZXJJZCwgd2lkdGgsIGhlaWdodCwgY3VycmVudFdpZHRoLCBjdXJyZW50SGVpZ2h0KSB7XG4gICAgICAgIGNvbnN0IHJ1bnRpbWVJbmZvID0gdGhpcy5vcGVuZWRCcm93c2Vyc1ticm93c2VySWRdO1xuXG4gICAgICAgIGlmIChydW50aW1lSW5mby5jb25maWcubW9iaWxlKVxuICAgICAgICAgICAgYXdhaXQgY2RwLnVwZGF0ZU1vYmlsZVZpZXdwb3J0U2l6ZShydW50aW1lSW5mbyk7XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgcnVudGltZUluZm8udmlld3BvcnRTaXplLndpZHRoICA9IGN1cnJlbnRXaWR0aDtcbiAgICAgICAgICAgIHJ1bnRpbWVJbmZvLnZpZXdwb3J0U2l6ZS5oZWlnaHQgPSBjdXJyZW50SGVpZ2h0O1xuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgY2RwLnJlc2l6ZVdpbmRvdyh7IHdpZHRoLCBoZWlnaHQgfSwgcnVudGltZUluZm8pO1xuICAgIH0sXG5cbiAgICBhc3luYyBnZXRWaWRlb0ZyYW1lRGF0YSAoYnJvd3NlcklkKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCBjZHAuZ2V0U2NyZWVuc2hvdERhdGEodGhpcy5vcGVuZWRCcm93c2Vyc1ticm93c2VySWRdKTtcbiAgICB9LFxuXG4gICAgYXN5bmMgaGFzQ3VzdG9tQWN0aW9uRm9yQnJvd3NlciAoYnJvd3NlcklkKSB7XG4gICAgICAgIGNvbnN0IHsgY29uZmlnLCBjbGllbnQgfSA9IHRoaXMub3BlbmVkQnJvd3NlcnNbYnJvd3NlcklkXTtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgaGFzQ2xvc2VCcm93c2VyOiAgICAgICAgICAgICAgICB0cnVlLFxuICAgICAgICAgICAgaGFzUmVzaXplV2luZG93OiAgICAgICAgICAgICAgICAhIWNsaWVudCAmJiAoY29uZmlnLmVtdWxhdGlvbiB8fCBjb25maWcuaGVhZGxlc3MpLFxuICAgICAgICAgICAgaGFzTWF4aW1pemVXaW5kb3c6ICAgICAgICAgICAgICAhIWNsaWVudCAmJiBjb25maWcuaGVhZGxlc3MsXG4gICAgICAgICAgICBoYXNUYWtlU2NyZWVuc2hvdDogICAgICAgICAgICAgICEhY2xpZW50LFxuICAgICAgICAgICAgaGFzQ2hyb21lbGVzc1NjcmVlbnNob3RzOiAgICAgICAhIWNsaWVudCxcbiAgICAgICAgICAgIGhhc0dldFZpZGVvRnJhbWVEYXRhOiAgICAgICAgICAgISFjbGllbnQsXG4gICAgICAgICAgICBoYXNDYW5SZXNpemVXaW5kb3dUb0RpbWVuc2lvbnM6IGZhbHNlXG4gICAgICAgIH07XG4gICAgfSxcblxuICAgIGFzeW5jIF9lbnN1cmVXaW5kb3dJc0V4cGFuZGVkIChicm93c2VySWQsIHsgaGVpZ2h0LCB3aWR0aCwgYXZhaWxhYmxlSGVpZ2h0LCBhdmFpbGFibGVXaWR0aCwgb3V0ZXJXaWR0aCwgb3V0ZXJIZWlnaHQgfSkge1xuICAgICAgICBpZiAoaGVpZ2h0IDwgTUlOX0FWQUlMQUJMRV9ESU1FTlNJT04gfHwgd2lkdGggPCBNSU5fQVZBSUxBQkxFX0RJTUVOU0lPTikge1xuICAgICAgICAgICAgY29uc3QgbmV3SGVpZ2h0ID0gTWF0aC5tYXgoYXZhaWxhYmxlSGVpZ2h0LCBNSU5fQVZBSUxBQkxFX0RJTUVOU0lPTik7XG4gICAgICAgICAgICBjb25zdCBuZXdXaWR0aCAgPSBNYXRoLm1heChNYXRoLmZsb29yKGF2YWlsYWJsZVdpZHRoIC8gMiksIE1JTl9BVkFJTEFCTEVfRElNRU5TSU9OKTtcblxuICAgICAgICAgICAgYXdhaXQgdGhpcy5yZXNpemVXaW5kb3coYnJvd3NlcklkLCBuZXdXaWR0aCwgbmV3SGVpZ2h0LCBvdXRlcldpZHRoLCBvdXRlckhlaWdodCk7XG4gICAgICAgIH1cbiAgICB9XG59O1xuIl19