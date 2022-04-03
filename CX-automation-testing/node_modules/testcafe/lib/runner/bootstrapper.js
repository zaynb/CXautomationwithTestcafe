"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const is_ci_1 = __importDefault(require("is-ci"));
const lodash_1 = require("lodash");
const make_dir_1 = __importDefault(require("make-dir"));
const os_family_1 = __importDefault(require("os-family"));
const testcafe_browser_tools_1 = require("testcafe-browser-tools");
const authentication_helper_1 = __importDefault(require("../cli/authentication-helper"));
const compiler_1 = __importDefault(require("../compiler"));
const connection_1 = __importDefault(require("../browser/connection"));
const pool_1 = __importDefault(require("../browser/provider/pool"));
const browser_set_1 = __importDefault(require("./browser-set"));
const remote_1 = __importDefault(require("../browser/provider/built-in/remote"));
const runtime_1 = require("../errors/runtime");
const types_1 = require("../errors/types");
const tested_app_1 = __importDefault(require("./tested-app"));
const parse_file_list_1 = __importDefault(require("../utils/parse-file-list"));
const resolve_path_relatively_cwd_1 = __importDefault(require("../utils/resolve-path-relatively-cwd"));
const load_1 = __importDefault(require("../custom-client-scripts/load"));
const string_1 = require("../utils/string");
const detect_display_1 = __importDefault(require("../utils/detect-display"));
const reporter_1 = require("../utils/reporter");
function isPromiseError(value) {
    return value.error !== void 0;
}
class Bootstrapper {
    constructor(browserConnectionGateway, compilerService) {
        this.browserConnectionGateway = browserConnectionGateway;
        this.concurrency = 1;
        this.sources = [];
        this.browsers = [];
        this.reporters = [];
        this.filter = void 0;
        this.appCommand = void 0;
        this.appInitDelay = void 0;
        this.tsConfigPath = void 0;
        this.clientScripts = [];
        this.disableMultipleWindows = false;
        this.compilerService = compilerService;
    }
    static _getBrowserName(browser) {
        if (browser instanceof connection_1.default)
            return browser.browserInfo.browserName;
        return browser.browserName;
    }
    static _splitBrowserInfo(browserInfo) {
        const remotes = [];
        const automated = [];
        browserInfo.forEach(browser => {
            if (browser instanceof connection_1.default)
                remotes.push(browser);
            else
                automated.push(browser);
        });
        return { remotes, automated };
    }
    static async _hasLocalBrowsers(browserInfo) {
        for (const browser of browserInfo) {
            if (browser instanceof connection_1.default)
                continue;
            if (await browser.provider.isLocalBrowser(void 0, browser.browserName))
                return true;
        }
        return false;
    }
    static async _checkRequiredPermissions(browserInfo) {
        const hasLocalBrowsers = await Bootstrapper._hasLocalBrowsers(browserInfo);
        const { error } = await authentication_helper_1.default(() => testcafe_browser_tools_1.findWindow(''), testcafe_browser_tools_1.errors.UnableToAccessScreenRecordingAPIError, {
            interactive: hasLocalBrowsers && !is_ci_1.default
        });
        if (!error)
            return;
        if (hasLocalBrowsers)
            throw error;
        remote_1.default.canDetectLocalBrowsers = false;
    }
    static async _checkThatTestsCanRunWithoutDisplay(browserInfoSource) {
        for (let browserInfo of browserInfoSource) {
            if (browserInfo instanceof connection_1.default)
                browserInfo = browserInfo.browserInfo;
            const isLocalBrowser = await browserInfo.provider.isLocalBrowser(void 0, browserInfo.browserName);
            const isHeadlessBrowser = await browserInfo.provider.isHeadlessBrowser(void 0, browserInfo.browserName);
            if (isLocalBrowser && !isHeadlessBrowser) {
                throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.cannotRunLocalNonHeadlessBrowserWithoutDisplay, browserInfo.alias);
            }
        }
    }
    async _getBrowserInfo() {
        if (!this.browsers.length)
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.browserNotSet);
        const browserInfo = await Promise.all(this.browsers.map(browser => pool_1.default.getBrowserInfo(browser)));
        return lodash_1.flatten(browserInfo);
    }
    _createAutomatedConnections(browserInfo) {
        if (!browserInfo)
            return [];
        return browserInfo
            .map(browser => lodash_1.times(this.concurrency, () => new connection_1.default(this.browserConnectionGateway, browser, false, this.disableMultipleWindows)));
    }
    async _getBrowserConnections(browserInfo) {
        const { automated, remotes } = Bootstrapper._splitBrowserInfo(browserInfo);
        if (remotes && remotes.length % this.concurrency)
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.cannotDivideRemotesCountByConcurrency);
        let browserConnections = this._createAutomatedConnections(automated);
        browserConnections = browserConnections.concat(lodash_1.chunk(remotes, this.concurrency));
        return await browser_set_1.default.from(browserConnections);
    }
    _filterTests(tests, predicate) {
        return tests.filter(test => predicate(test.name, test.fixture.name, test.fixture.path, test.meta, test.fixture.meta));
    }
    async _compileTests({ sourceList, compilerOptions }) {
        if (this.compilerService) {
            await this.compilerService.init();
            return this.compilerService.getTests({ sourceList, compilerOptions });
        }
        const compiler = new compiler_1.default(sourceList, compilerOptions);
        return compiler.getTests();
    }
    async _getTests() {
        const cwd = process.cwd();
        const { sourceList, compilerOptions } = await this._getCompilerArguments(cwd);
        if (!sourceList.length)
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.testFilesNotFound, string_1.getConcatenatedValuesString(this.sources, '\n', ''), cwd);
        let tests = await this._compileTests({ sourceList, compilerOptions });
        const testsWithOnlyFlag = tests.filter(test => test.only);
        if (testsWithOnlyFlag.length)
            tests = testsWithOnlyFlag;
        if (!tests.length)
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.noTestsToRun);
        if (this.filter)
            tests = this._filterTests(tests, this.filter);
        if (!tests.length)
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.noTestsToRunDueFiltering);
        return tests;
    }
    async _getCompilerArguments(cwd) {
        const sourceList = await parse_file_list_1.default(this.sources, cwd);
        const compilerOptions = {
            typeScriptOptions: {
                tsConfigPath: this.tsConfigPath
            }
        };
        return { sourceList, compilerOptions };
    }
    async _ensureOutStream(outStream) {
        if (typeof outStream !== 'string')
            return outStream;
        const fullReporterOutputPath = resolve_path_relatively_cwd_1.default(outStream);
        await make_dir_1.default(path_1.default.dirname(fullReporterOutputPath));
        return fs_1.default.createWriteStream(fullReporterOutputPath);
    }
    static _addDefaultReporter(reporters) {
        reporters.push({
            name: 'spec',
            output: process.stdout
        });
    }
    async _getReporterPlugins() {
        if (!this.reporters.length)
            Bootstrapper._addDefaultReporter(this.reporters);
        return Promise.all(this.reporters.map(async ({ name, output }) => {
            const pluginFactory = reporter_1.getPluginFactory(name);
            const processedName = reporter_1.processReporterName(name);
            const outStream = output ? await this._ensureOutStream(output) : void 0;
            return {
                plugin: pluginFactory(),
                name: processedName,
                outStream
            };
        }));
    }
    async _startTestedApp() {
        if (!this.appCommand)
            return void 0;
        const testedApp = new tested_app_1.default();
        await testedApp.start(this.appCommand, this.appInitDelay);
        return testedApp;
    }
    async _canUseParallelBootstrapping(browserInfo) {
        const isLocalPromises = browserInfo.map(browser => browser.provider.isLocalBrowser(void 0, Bootstrapper._getBrowserName(browser)));
        const isLocalBrowsers = await Promise.all(isLocalPromises);
        return isLocalBrowsers.every(result => result);
    }
    async _bootstrapSequence(browserInfo) {
        const tests = await this._getTests();
        const testedApp = await this._startTestedApp();
        const browserSet = await this._getBrowserConnections(browserInfo);
        return { tests, testedApp, browserSet };
    }
    _wrapBootstrappingPromise(promise) {
        return promise
            .then(result => ({ error: void 0, result }))
            .catch(error => ({ result: void 0, error }));
    }
    async _getBootstrappingError(browserSetStatus, testsStatus, testedAppStatus) {
        if (!isPromiseError(browserSetStatus))
            await browserSetStatus.result.dispose();
        if (!isPromiseError(browserSetStatus) && !isPromiseError(testedAppStatus) && testedAppStatus.result)
            await testedAppStatus.result.kill();
        if (isPromiseError(testsStatus))
            return testsStatus.error;
        if (isPromiseError(testedAppStatus))
            return testedAppStatus.error;
        if (isPromiseError(browserSetStatus))
            return browserSetStatus.error;
        return new Error('Unexpected call');
    }
    _getBootstrappingPromises(arg) {
        const result = {};
        for (const k in arg)
            result[k] = this._wrapBootstrappingPromise(arg[k]);
        return result;
    }
    async _bootstrapParallel(browserInfo) {
        const bootstrappingPromises = {
            browserSet: this._getBrowserConnections(browserInfo),
            tests: this._getTests(),
            app: this._startTestedApp()
        };
        const bootstrappingResultPromises = this._getBootstrappingPromises(bootstrappingPromises);
        const bootstrappingResults = await Promise.all([
            bootstrappingResultPromises.browserSet,
            bootstrappingResultPromises.tests,
            bootstrappingResultPromises.app
        ]);
        const [browserSetResults, testResults, appResults] = bootstrappingResults;
        if (isPromiseError(browserSetResults) || isPromiseError(testResults) || isPromiseError(appResults))
            throw await this._getBootstrappingError(...bootstrappingResults);
        return {
            browserSet: browserSetResults.result,
            tests: testResults.result,
            testedApp: appResults.result
        };
    }
    // API
    async createRunnableConfiguration() {
        const reporterPlugins = await this._getReporterPlugins();
        const commonClientScripts = await load_1.default(this.clientScripts);
        // NOTE: If a user forgot to specify a browser, but has specified a path to tests, the specified path will be
        // considered as the browser argument, and the tests path argument will have the predefined default value.
        // It's very ambiguous for the user, who might be confused by compilation errors from an unexpected test.
        // So, we need to retrieve the browser aliases and paths before tests compilation.
        const browserInfo = await this._getBrowserInfo();
        if (os_family_1.default.mac)
            await Bootstrapper._checkRequiredPermissions(browserInfo);
        if (os_family_1.default.linux && !detect_display_1.default())
            await Bootstrapper._checkThatTestsCanRunWithoutDisplay(browserInfo);
        if (await this._canUseParallelBootstrapping(browserInfo))
            return Object.assign(Object.assign({ reporterPlugins }, await this._bootstrapParallel(browserInfo)), { commonClientScripts });
        return Object.assign(Object.assign({ reporterPlugins }, await this._bootstrapSequence(browserInfo)), { commonClientScripts });
    }
}
exports.default = Bootstrapper;
module.exports = exports.default;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYm9vdHN0cmFwcGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3J1bm5lci9ib290c3RyYXBwZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSxnREFBd0I7QUFDeEIsNENBQW9CO0FBQ3BCLGtEQUF5QjtBQUN6QixtQ0FJZ0I7QUFFaEIsd0RBQStCO0FBQy9CLDBEQUEyQjtBQUMzQixtRUFBNEQ7QUFDNUQseUZBQWdFO0FBQ2hFLDJEQUFtQztBQUNuQyx1RUFBdUU7QUFDdkUsb0VBQTJEO0FBQzNELGdFQUF1QztBQUN2QyxpRkFBd0U7QUFDeEUsK0NBQWlEO0FBQ2pELDJDQUFpRDtBQUNqRCw4REFBcUM7QUFDckMsK0VBQXFEO0FBQ3JELHVHQUE0RTtBQUM1RSx5RUFBOEQ7QUFDOUQsNENBQThEO0FBVzlELDZFQUFvRDtBQUNwRCxnREFBMEU7QUFpQzFFLFNBQVMsY0FBYyxDQUE4QixLQUEwQjtJQUMzRSxPQUFRLEtBQXlCLENBQUMsS0FBSyxLQUFLLEtBQUssQ0FBQyxDQUFDO0FBQ3ZELENBQUM7QUFhRCxNQUFxQixZQUFZO0lBZ0I3QixZQUFvQix3QkFBa0QsRUFBRSxlQUFpQztRQUNyRyxJQUFJLENBQUMsd0JBQXdCLEdBQUcsd0JBQXdCLENBQUM7UUFDekQsSUFBSSxDQUFDLFdBQVcsR0FBZ0IsQ0FBQyxDQUFDO1FBQ2xDLElBQUksQ0FBQyxPQUFPLEdBQW9CLEVBQUUsQ0FBQztRQUNuQyxJQUFJLENBQUMsUUFBUSxHQUFtQixFQUFFLENBQUM7UUFDbkMsSUFBSSxDQUFDLFNBQVMsR0FBa0IsRUFBRSxDQUFDO1FBQ25DLElBQUksQ0FBQyxNQUFNLEdBQXFCLEtBQUssQ0FBQyxDQUFDO1FBQ3ZDLElBQUksQ0FBQyxVQUFVLEdBQWlCLEtBQUssQ0FBQyxDQUFDO1FBQ3ZDLElBQUksQ0FBQyxZQUFZLEdBQWUsS0FBSyxDQUFDLENBQUM7UUFDdkMsSUFBSSxDQUFDLFlBQVksR0FBZSxLQUFLLENBQUMsQ0FB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OUQsSUFBSSxtQkFBRSxDQUFDLEtBQUssSUFBSSxDQUFDLHdCQUFhLEVBQUU7WUFDNUIsTUFBTSxZQUFZLENBQUMsbUNBQW1DLENBQUMsV0FBVyxDQUFDLENBQUM7UUFFeEUsSUFBSSxNQUFNLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxXQUFXLENBQUM7WUFDcEQscUNBQVMsZUFBZSxJQUFLLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLFdBQVcsQ0FBQyxLQUFFLG1CQUFtQixJQUFHO1FBRW5HLHFDQUFTLGVBQWUsSUFBSyxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxXQUFXLENBQUMsS0FBRSxtQkFBbUIsSUFBRztJQUNuRyxDQUFDO0NBQ0o7QUExVUQsK0JBMFVDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgZnMgZnJvbSAnZnMnO1xuaW1wb3J0IGlzQ0kgZnJvbSAnaXMtY2knO1xuaW1wb3J0IHtcbiAgICBmbGF0dGVuLFxuICAgIGNodW5rLFxuICAgIHRpbWVzXG59IGZyb20gJ2xvZGFzaCc7XG5cbmltcG9ydCBtYWtlRGlyIGZyb20gJ21ha2UtZGlyJztcbmltcG9ydCBPUyBmcm9tICdvcy1mYW1pbHknO1xuaW1wb3J0IHsgZXJyb3JzLCBmaW5kV2luZG93IH0gZnJvbSAndGVzdGNhZmUtYnJvd3Nlci10b29scyc7XG5pbXBvcnQgYXV0aGVudGljYXRpb25IZWxwZXIgZnJvbSAnLi4vY2xpL2F1dGhlbnRpY2F0aW9uLWhlbHBlcic7XG5pbXBvcnQgQ29tcGlsZXIgZnJvbSAnLi4vY29tcGlsZXInO1xuaW1wb3J0IEJyb3dzZXJDb25uZWN0aW9uLCB7IEJyb3dzZXJJbmZvIH0gZnJvbSAnLi4vYnJvd3Nlci9jb25uZWN0aW9uJztcbmltcG9ydCBicm93c2VyUHJvdmlkZXJQb29sIGZyb20gJy4uL2Jyb3dzZXIvcHJvdmlkZXIvcG9vbCc7XG5pbXBvcnQgQnJvd3NlclNldCBmcm9tICcuL2Jyb3dzZXItc2V0JztcbmltcG9ydCBSZW1vdGVCcm93c2VyUHJvdmlkZXIgZnJvbSAnLi4vYnJvd3Nlci9wcm92aWRlci9idWlsdC1pbi9yZW1vdGUnO1xuaW1wb3J0IHsgR2VuZXJhbEVycm9yIH0gZnJvbSAnLi4vZXJyb3JzL3J1bnRpbWUnO1xuaW1wb3J0IHsgUlVOVElNRV9FUlJPUlMgfSBmcm9tICcuLi9lcnJvcnMvdHlwZXMnO1xuaW1wb3J0IFRlc3RlZEFwcCBmcm9tICcuL3Rlc3RlZC1hcHAnO1xuaW1wb3J0IHBhcnNlRmlsZUxpc3QgZnJvbSAnLi4vdXRpbHMvcGFyc2UtZmlsZS1saXN0JztcbmltcG9ydCByZXNvbHZlUGF0aFJlbGF0aXZlbHlDd2QgZnJvbSAnLi4vdXRpbHMvcmVzb2x2ZS1wYXRoLXJlbGF0aXZlbHktY3dkJztcbmltcG9ydCBsb2FkQ2xpZW50U2NyaXB0cyBmcm9tICcuLi9jdXN0b20tY2xpZW50LXNjcmlwdHMvbG9hZCc7XG5pbXBvcnQgeyBnZXRDb25jYXRlbmF0ZWRWYWx1ZXNTdHJpbmcgfSBmcm9tICcuLi91dGlscy9zdHJpbmcnO1xuXG5pbXBvcnQgeyBXcml0YWJsZSBhcyBXcml0YWJsZVN0cmVhbSB9IGZyb20gJ3N0cmVhbSc7XG5pbXBvcnQgeyBSZXBvcnRlclNvdXJjZSwgUmVwb3J0ZXJQbHVnaW5Tb3VyY2UgfSBmcm9tICcuLi9yZXBvcnRlci9pbnRlcmZhY2VzJztcbmltcG9ydCBDbGllbnRTY3JpcHQgZnJvbSAnLi4vY3VzdG9tLWNsaWVudC1zY3JpcHRzL2NsaWVudC1zY3JpcHQnO1xuaW1wb3J0IENsaWVudFNjcmlwdEluaXQgZnJvbSAnLi4vY3VzdG9tLWNsaWVudC1zY3JpcHRzL2NsaWVudC1zY3JpcHQtaW5pdCc7XG5pbXBvcnQgQnJvd3NlckNvbm5lY3Rpb25HYXRld2F5IGZyb20gJy4uL2Jyb3dzZXIvY29ubmVjdGlvbi9nYXRld2F5JztcbmltcG9ydCB7IENvbXBpbGVyQXJndW1lbnRzIH0gZnJvbSAnLi4vY29tcGlsZXIvaW50ZXJmYWNlcyc7XG5pbXBvcnQgQ29tcGlsZXJTZXJ2aWNlIGZyb20gJy4uL3NlcnZpY2VzL2NvbXBpbGVyL2hvc3QnO1xuaW1wb3J0IHsgTWV0YWRhdGEgfSBmcm9tICcuLi9hcGkvc3RydWN0dXJlL2ludGVyZmFjZXMnO1xuaW1wb3J0IFRlc3QgZnJvbSAnLi4vYXBpL3N0cnVjdHVyZS90ZXN0JztcbmltcG9ydCBkZXRlY3REaXNwbGF5IGZyb20gJy4uL3V0aWxzL2RldGVjdC1kaXNwbGF5JztcbmltcG9ydCB7IGdldFBsdWdpbkZhY3RvcnksIHByb2Nlc3NSZXBvcnRlck5hbWUgfSBmcm9tICcuLi91dGlscy9yZXBvcnRlcic7XG5cbnR5cGUgVGVzdFNvdXJjZSA9IHVua25vd247XG5cbnR5cGUgQnJvd3NlclNvdXJjZSA9IEJyb3dzZXJDb25uZWN0aW9uIHwgc3RyaW5nO1xuXG5pbnRlcmZhY2UgRmlsdGVyIHtcbiAgICAodGVzdE5hbWU6IHN0cmluZywgZml4dHVyZU5hbWU6IHN0cmluZywgZml4dHVyZVBhdGg6IHN0cmluZywgdGVzdE1ldGE6IE1ldGFkYXRhLCBmaXh0dXJlTWV0YTogTWV0YWRhdGEpOiBib29sZWFuO1xufVxuXG50eXBlIEJyb3dzZXJJbmZvU291cmNlID0gQnJvd3NlckluZm8gfCBCcm93c2VyQ29ubmVjdGlvbjtcblxuaW50ZXJmYWNlIFByb21pc2VTdWNjZXNzPFQ+IHtcbiAgICByZXN1bHQ6IFQ7XG59XG5cbmludGVyZmFjZSBQcm9taXNlRXJyb3I8RSBleHRlbmRzIEVycm9yID0gRXJyb3I+IHtcbiAgICBlcnJvcjogRTtcbn1cblxuaW50ZXJmYWNlIEJhc2ljUnVudGltZVJlc291cmNlcyB7XG4gICAgYnJvd3NlclNldDogQnJvd3NlclNldDtcbiAgICB0ZXN0czogVGVzdFtdO1xuICAgIHRlc3RlZEFwcD86IFRlc3RlZEFwcDtcbn1cblxuaW50ZXJmYWNlIFJ1bnRpbWVSZXNvdXJjZXMgZXh0ZW5kcyBCYXNpY1J1bnRpbWVSZXNvdXJjZXMge1xuICAgIHJlcG9ydGVyUGx1Z2luczogUmVwb3J0ZXJQbHVnaW5Tb3VyY2VbXTtcbiAgICBjb21tb25DbGllbnRTY3JpcHRzOiBDbGllbnRTY3JpcHRbXTtcbn1cblxudHlwZSBQcm9taXNlUmVzdWx0PFQsIEUgZXh0ZW5kcyBFcnJvciA9IEVycm9yPiA9IFByb21pc2VTdWNjZXNzPFQ+IHwgUHJvbWlzZUVycm9yPEU+O1xuXG5mdW5jdGlvbiBpc1Byb21pc2VFcnJvcjxULCBFIGV4dGVuZHMgRXJyb3IgPSBFcnJvcj4gKHZhbHVlOiBQcm9taXNlUmVzdWx0PFQsIEU+KTogdmFsdWUgaXMgUHJvbWlzZUVycm9yPEU+IHtcbiAgICByZXR1cm4gKHZhbHVlIGFzIFByb21pc2VFcnJvcjxFPikuZXJyb3IgIT09IHZvaWQgMDtcbn1cblxuaW50ZXJmYWNlIFNlcGFyYXRlZEJyb3dzZXJJbmZvIHtcbiAgICByZW1vdGVzOiBCcm93c2VyQ29ubmVjdGlvbltdO1xuICAgIGF1dG9tYXRlZDogQnJvd3NlckluZm9bXTtcbn1cblxudHlwZSBQcm9taXNlQ29sbGVjdGlvbjxUPiA9IHtcbiAgICBbSyBpbiBrZXlvZiBUXTogUHJvbWlzZTxUW0tdPlxufVxuXG50eXBlIFJlc3VsdENvbGxlY3Rpb248VD4gPSB7IFtQIGluIGtleW9mIFRdOiBQcm9taXNlUmVzdWx0PFRbUF0+IH07XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJvb3RzdHJhcHBlciB7XG4gICAgcHJpdmF0ZSByZWFkb25seSBicm93c2VyQ29ubmVjdGlvbkdhdGV3YXk6IEJyb3dzZXJDb25uZWN0aW9uR2F0ZXdheTtcblxuICAgIHB1YmxpYyBjb25jdXJyZW5jeTogbnVtYmVyO1xuICAgIHB1YmxpYyBzb3VyY2VzOiBUZXN0U291cmNlW107XG4gICAgcHVibGljIGJyb3dzZXJzOiBCcm93c2VyU291cmNlW107XG4gICAgcHVibGljIHJlcG9ydGVyczogUmVwb3J0ZXJTb3VyY2VbXTtcbiAgICBwdWJsaWMgZmlsdGVyPzogRmlsdGVyO1xuICAgIHB1YmxpYyBhcHBDb21tYW5kPzogc3RyaW5nO1xuICAgIHB1YmxpYyBhcHBJbml0RGVsYXk/OiBudW1iZXI7XG4gICAgcHVibGljIHRzQ29uZmlnUGF0aD86IHN0cmluZztcbiAgICBwdWJsaWMgY2xpZW50U2NyaXB0czogQ2xpZW50U2NyaXB0SW5pdFtdO1xuICAgIHB1YmxpYyBkaXNhYmxlTXVsdGlwbGVXaW5kb3dzOiBib29sZWFuO1xuXG4gICAgcHJpdmF0ZSByZWFkb25seSBjb21waWxlclNlcnZpY2U/OiBDb21waWxlclNlcnZpY2U7XG5cbiAgICBwdWJsaWMgY29uc3RydWN0b3IgKGJyb3dzZXJDb25uZWN0aW9uR2F0ZXdheTogQnJvd3NlckNvbm5lY3Rpb25HYXRld2F5LCBjb21waWxlclNlcnZpY2U/OiBDb21waWxlclNlcnZpY2UpIHtcbiAgICAgICAgdGhpcy5icm93c2VyQ29ubmVjdGlvbkdhdGV3YXkgPSBicm93c2VyQ29ubmVjdGlvbkdhdGV3YXk7XG4gICAgICAgIHRoaXMuY29uY3VycmVuY3kgICAgICAgICAgICAgID0gMTtcbiAgICAgICAgdGhpcy5zb3VyY2VzICAgICAgICAgICAgICAgICAgPSBbXTtcbiAgICAgICAgdGhpcy5icm93c2VycyAgICAgICAgICAgICAgICAgPSBbXTtcbiAgICAgICAgdGhpcy5yZXBvcnRlcnMgICAgICAgICAgICAgICAgPSBbXTtcbiAgICAgICAgdGhpcy5maWx0ZXIgICAgICAgICAgICAgICAgICAgPSB2b2lkIDA7XG4gICAgICAgIHRoaXMuYXBwQ29tbWFuZCAgICAgICAgICAgICAgID0gdm9pZCAwO1xuICAgICAgICB0aGlzLmFwcEluaXREZWxheSAgICAgICAgICAgICA9IHZvaWQgMDtcbiAgICAgICAgdGhpcy50c0NvbmZpZ1BhdGggICAgICAgICAgICAgPSB2b2lkIDA7XG4gICAgICAgIHRoaXMuY2xpZW50U2NyaXB0cyAgICAgICAgICAgID0gW107XG4gICAgICAgIHRoaXMuZGlzYWJsZU11bHRpcGxlV2luZG93cyAgID0gZmFsc2U7XG5cbiAgICAgICAgdGhpcy5jb21waWxlclNlcnZpY2UgPSBjb21waWxlclNlcnZpY2U7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBzdGF0aWMgX2dldEJyb3dzZXJOYW1lIChicm93c2VyOiBCcm93c2VySW5mb1NvdXJjZSk6IHN0cmluZyB7XG4gICAgICAgIGlmIChicm93c2VyIGluc3RhbmNlb2YgQnJvd3NlckNvbm5lY3Rpb24pXG4gICAgICAgICAgICByZXR1cm4gYnJvd3Nlci5icm93c2VySW5mby5icm93c2VyTmFtZTtcblxuICAgICAgICByZXR1cm4gYnJvd3Nlci5icm93c2VyTmFtZTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHN0YXRpYyBfc3BsaXRCcm93c2VySW5mbyAoYnJvd3NlckluZm86IEJyb3dzZXJJbmZvU291cmNlW10pOiBTZXBhcmF0ZWRCcm93c2VySW5mbyB7XG4gICAgICAgIGNvbnN0IHJlbW90ZXM6IEJyb3dzZXJDb25uZWN0aW9uW10gID0gW107XG4gICAgICAgIGNvbnN0IGF1dG9tYXRlZDogQnJvd3NlckluZm9bXSAgICAgID0gW107XG5cbiAgICAgICAgYnJvd3NlckluZm8uZm9yRWFjaChicm93c2VyID0+IHtcbiAgICAgICAgICAgIGlmIChicm93c2VyIGluc3RhbmNlb2YgQnJvd3NlckNvbm5lY3Rpb24pXG4gICAgICAgICAgICAgICAgcmVtb3Rlcy5wdXNoKGJyb3dzZXIpO1xuICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgIGF1dG9tYXRlZC5wdXNoKGJyb3dzZXIpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4geyByZW1vdGVzLCBhdXRvbWF0ZWQgfTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHN0YXRpYyBhc3luYyBfaGFzTG9jYWxCcm93c2VycyAoYnJvd3NlckluZm86IEJyb3dzZXJJbmZvU291cmNlW10pOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICAgICAgZm9yIChjb25zdCBicm93c2VyIG9mIGJyb3dzZXJJbmZvKSB7XG4gICAgICAgICAgICBpZiAoYnJvd3NlciBpbnN0YW5jZW9mIEJyb3dzZXJDb25uZWN0aW9uKVxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuXG4gICAgICAgICAgICBpZiAoYXdhaXQgYnJvd3Nlci5wcm92aWRlci5pc0xvY2FsQnJvd3Nlcih2b2lkIDAsIGJyb3dzZXIuYnJvd3Nlck5hbWUpKVxuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIHByaXZhdGUgc3RhdGljIGFzeW5jIF9jaGVja1JlcXVpcmVkUGVybWlzc2lvbnMgKGJyb3dzZXJJbmZvOiBCcm93c2VySW5mb1NvdXJjZVtdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGNvbnN0IGhhc0xvY2FsQnJvd3NlcnMgPSBhd2FpdCBCb290c3RyYXBwZXIuX2hhc0xvY2FsQnJvd3NlcnMoYnJvd3NlckluZm8pO1xuXG4gICAgICAgIGNvbnN0IHsgZXJyb3IgfSA9IGF3YWl0IGF1dGhlbnRpY2F0aW9uSGVscGVyKFxuICAgICAgICAgICAgKCkgPT4gZmluZFdpbmRvdygnJyksXG4gICAgICAgICAgICBlcnJvcnMuVW5hYmxlVG9BY2Nlc3NTY3JlZW5SZWNvcmRpbmdBUElFcnJvcixcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBpbnRlcmFjdGl2ZTogaGFzTG9jYWxCcm93c2VycyAmJiAhaXNDSVxuICAgICAgICAgICAgfVxuICAgICAgICApO1xuXG4gICAgICAgIGlmICghZXJyb3IpXG4gICAgICAgICAgICByZXR1cm47XG5cbiAgICAgICAgaWYgKGhhc0xvY2FsQnJvd3NlcnMpXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcblxuICAgICAgICBSZW1vdGVCcm93c2VyUHJvdmlkZXIuY2FuRGV0ZWN0TG9jYWxCcm93c2VycyA9IGZhbHNlO1xuICAgIH1cblxuICAgIHByaXZhdGUgc3RhdGljIGFzeW5jIF9jaGVja1RoYXRUZXN0c0NhblJ1bldpdGhvdXREaXNwbGF5IChicm93c2VySW5mb1NvdXJjZTogQnJvd3NlckluZm9Tb3VyY2VbXSk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBmb3IgKGxldCBicm93c2VySW5mbyBvZiBicm93c2VySW5mb1NvdXJjZSkge1xuICAgICAgICAgICAgaWYgKGJyb3dzZXJJbmZvIGluc3RhbmNlb2YgQnJvd3NlckNvbm5lY3Rpb24pXG4gICAgICAgICAgICAgICAgYnJvd3NlckluZm8gPSBicm93c2VySW5mby5icm93c2VySW5mbztcblxuICAgICAgICAgICAgY29uc3QgaXNMb2NhbEJyb3dzZXIgICAgPSBhd2FpdCBicm93c2VySW5mby5wcm92aWRlci5pc0xvY2FsQnJvd3Nlcih2b2lkIDAsIGJyb3dzZXJJbmZvLmJyb3dzZXJOYW1lKTtcbiAgICAgICAgICAgIGNvbnN0IGlzSGVhZGxlc3NCcm93c2VyID0gYXdhaXQgYnJvd3NlckluZm8ucHJvdmlkZXIuaXNIZWFkbGVzc0Jyb3dzZXIodm9pZCAwLCBicm93c2VySW5mby5icm93c2VyTmFtZSk7XG5cbiAgICAgICAgICAgIGlmIChpc0xvY2FsQnJvd3NlciAmJiAhaXNIZWFkbGVzc0Jyb3dzZXIpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgR2VuZXJhbEVycm9yKFxuICAgICAgICAgICAgICAgICAgICBSVU5USU1FX0VSUk9SUy5jYW5ub3RSdW5Mb2NhbE5vbkhlYWRsZXNzQnJvd3NlcldpdGhvdXREaXNwbGF5LFxuICAgICAgICAgICAgICAgICAgICBicm93c2VySW5mby5hbGlhc1xuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIF9nZXRCcm93c2VySW5mbyAoKTogUHJvbWlzZTxCcm93c2VySW5mb1NvdXJjZVtdPiB7XG4gICAgICAgIGlmICghdGhpcy5icm93c2Vycy5sZW5ndGgpXG4gICAgICAgICAgICB0aHJvdyBuZXcgR2VuZXJhbEVycm9yKFJVTlRJTUVfRVJST1JTLmJyb3dzZXJOb3RTZXQpO1xuXG4gICAgICAgIGNvbnN0IGJyb3dzZXJJbmZvID0gYXdhaXQgUHJvbWlzZS5hbGwodGhpcy5icm93c2Vycy5tYXAoYnJvd3NlciA9PiBicm93c2VyUHJvdmlkZXJQb29sLmdldEJyb3dzZXJJbmZvKGJyb3dzZXIpKSk7XG5cbiAgICAgICAgcmV0dXJuIGZsYXR0ZW4oYnJvd3NlckluZm8pO1xuICAgIH1cblxuICAgIHByaXZhdGUgX2NyZWF0ZUF1dG9tYXRlZENvbm5lY3Rpb25zIChicm93c2VySW5mbzogQnJvd3NlckluZm9bXSk6IEJyb3dzZXJDb25uZWN0aW9uW11bXSB7XG4gICAgICAgIGlmICghYnJvd3NlckluZm8pXG4gICAgICAgICAgICByZXR1cm4gW107XG5cbiAgICAgICAgcmV0dXJuIGJyb3dzZXJJbmZvXG4gICAgICAgICAgICAubWFwKGJyb3dzZXIgPT4gdGltZXModGhpcy5jb25jdXJyZW5jeSwgKCkgPT4gbmV3IEJyb3dzZXJDb25uZWN0aW9uKHRoaXMuYnJvd3NlckNvbm5lY3Rpb25HYXRld2F5LCBicm93c2VyLCBmYWxzZSwgdGhpcy5kaXNhYmxlTXVsdGlwbGVXaW5kb3dzKSkpO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgX2dldEJyb3dzZXJDb25uZWN0aW9ucyAoYnJvd3NlckluZm86IEJyb3dzZXJJbmZvU291cmNlW10pOiBQcm9taXNlPEJyb3dzZXJTZXQ+IHtcbiAgICAgICAgY29uc3QgeyBhdXRvbWF0ZWQsIHJlbW90ZXMgfSA9IEJvb3RzdHJhcHBlci5fc3BsaXRCcm93c2VySW5mbyhicm93c2VySW5mbyk7XG5cbiAgICAgICAgaWYgKHJlbW90ZXMgJiYgcmVtb3Rlcy5sZW5ndGggJSB0aGlzLmNvbmN1cnJlbmN5KVxuICAgICAgICAgICAgdGhyb3cgbmV3IEdlbmVyYWxFcnJvcihSVU5USU1FX0VSUk9SUy5jYW5ub3REaXZpZGVSZW1vdGVzQ291bnRCeUNvbmN1cnJlbmN5KTtcblxuICAgICAgICBsZXQgYnJvd3NlckNvbm5lY3Rpb25zID0gdGhpcy5fY3JlYXRlQXV0b21hdGVkQ29ubmVjdGlvbnMoYXV0b21hdGVkKTtcblxuICAgICAgICBicm93c2VyQ29ubmVjdGlvbnMgPSBicm93c2VyQ29ubmVjdGlvbnMuY29uY2F0KGNodW5rKHJlbW90ZXMsIHRoaXMuY29uY3VycmVuY3kpKTtcblxuICAgICAgICByZXR1cm4gYXdhaXQgQnJvd3NlclNldC5mcm9tKGJyb3dzZXJDb25uZWN0aW9ucyk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfZmlsdGVyVGVzdHMgKHRlc3RzOiBUZXN0W10sIHByZWRpY2F0ZTogRmlsdGVyKTogVGVzdFtdIHtcbiAgICAgICAgcmV0dXJuIHRlc3RzLmZpbHRlcih0ZXN0ID0+IHByZWRpY2F0ZSh0ZXN0Lm5hbWUgYXMgc3RyaW5nLCB0ZXN0LmZpeHR1cmUubmFtZSBhcyBzdHJpbmcsIHRlc3QuZml4dHVyZS5wYXRoLCB0ZXN0Lm1ldGEsIHRlc3QuZml4dHVyZS5tZXRhKSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBfY29tcGlsZVRlc3RzICh7IHNvdXJjZUxpc3QsIGNvbXBpbGVyT3B0aW9ucyB9OiBDb21waWxlckFyZ3VtZW50cyk6IFByb21pc2U8VGVzdFtdPiB7XG4gICAgICAgIGlmICh0aGlzLmNvbXBpbGVyU2VydmljZSkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5jb21waWxlclNlcnZpY2UuaW5pdCgpO1xuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5jb21waWxlclNlcnZpY2UuZ2V0VGVzdHMoeyBzb3VyY2VMaXN0LCBjb21waWxlck9wdGlvbnMgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjb21waWxlciA9IG5ldyBDb21waWxlcihzb3VyY2VMaXN0LCBjb21waWxlck9wdGlvbnMpO1xuXG4gICAgICAgIHJldHVybiBjb21waWxlci5nZXRUZXN0cygpO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgX2dldFRlc3RzICgpOiBQcm9taXNlPFRlc3RbXT4ge1xuICAgICAgICBjb25zdCBjd2QgICAgICAgICAgICAgICAgICAgICAgICAgICAgID0gcHJvY2Vzcy5jd2QoKTtcbiAgICAgICAgY29uc3QgeyBzb3VyY2VMaXN0LCBjb21waWxlck9wdGlvbnMgfSA9IGF3YWl0IHRoaXMuX2dldENvbXBpbGVyQXJndW1lbnRzKGN3ZCk7XG5cbiAgICAgICAgaWYgKCFzb3VyY2VMaXN0Lmxlbmd0aClcbiAgICAgICAgICAgIHRocm93IG5ldyBHZW5lcmFsRXJyb3IoUlVOVElNRV9FUlJPUlMudGVzdEZpbGVzTm90Rm91bmQsIGdldENvbmNhdGVuYXRlZFZhbHVlc1N0cmluZyh0aGlzLnNvdXJjZXMsICdcXG4nLCAnJyksIGN3ZCk7XG5cbiAgICAgICAgbGV0IHRlc3RzID0gYXdhaXQgdGhpcy5fY29tcGlsZVRlc3RzKHsgc291cmNlTGlzdCwgY29tcGlsZXJPcHRpb25zIH0pO1xuXG4gICAgICAgIGNvbnN0IHRlc3RzV2l0aE9ubHlGbGFnID0gdGVzdHMuZmlsdGVyKHRlc3QgPT4gdGVzdC5vbmx5KTtcblxuICAgICAgICBpZiAodGVzdHNXaXRoT25seUZsYWcubGVuZ3RoKVxuICAgICAgICAgICAgdGVzdHMgPSB0ZXN0c1dpdGhPbmx5RmxhZztcblxuICAgICAgICBpZiAoIXRlc3RzLmxlbmd0aClcbiAgICAgICAgICAgIHRocm93IG5ldyBHZW5lcmFsRXJyb3IoUlVOVElNRV9FUlJPUlMubm9UZXN0c1RvUnVuKTtcblxuICAgICAgICBpZiAodGhpcy5maWx0ZXIpXG4gICAgICAgICAgICB0ZXN0cyA9IHRoaXMuX2ZpbHRlclRlc3RzKHRlc3RzLCB0aGlzLmZpbHRlcik7XG5cbiAgICAgICAgaWYgKCF0ZXN0cy5sZW5ndGgpXG4gICAgICAgICAgICB0aHJvdyBuZXcgR2VuZXJhbEVycm9yKFJVTlRJTUVfRVJST1JTLm5vVGVzdHNUb1J1bkR1ZUZpbHRlcmluZyk7XG5cbiAgICAgICAgcmV0dXJuIHRlc3RzO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgX2dldENvbXBpbGVyQXJndW1lbnRzIChjd2Q6IHN0cmluZyk6IFByb21pc2U8Q29tcGlsZXJBcmd1bWVudHM+IHtcbiAgICAgICAgY29uc3Qgc291cmNlTGlzdCA9IGF3YWl0IHBhcnNlRmlsZUxpc3QodGhpcy5zb3VyY2VzLCBjd2QpO1xuXG4gICAgICAgIGNvbnN0IGNvbXBpbGVyT3B0aW9ucyA9IHtcbiAgICAgICAgICAgIHR5cGVTY3JpcHRPcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgdHNDb25maWdQYXRoOiB0aGlzLnRzQ29uZmlnUGF0aFxuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIHJldHVybiB7IHNvdXJjZUxpc3QsIGNvbXBpbGVyT3B0aW9ucyB9O1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgX2Vuc3VyZU91dFN0cmVhbSAob3V0U3RyZWFtOiBzdHJpbmcgfCBXcml0YWJsZVN0cmVhbSk6IFByb21pc2U8V3JpdGFibGVTdHJlYW0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiBvdXRTdHJlYW0gIT09ICdzdHJpbmcnKVxuICAgICAgICAgICAgcmV0dXJuIG91dFN0cmVhbTtcblxuICAgICAgICBjb25zdCBmdWxsUmVwb3J0ZXJPdXRwdXRQYXRoID0gcmVzb2x2ZVBhdGhSZWxhdGl2ZWx5Q3dkKG91dFN0cmVhbSk7XG5cbiAgICAgICAgYXdhaXQgbWFrZURpcihwYXRoLmRpcm5hbWUoZnVsbFJlcG9ydGVyT3V0cHV0UGF0aCkpO1xuXG4gICAgICAgIHJldHVybiBmcy5jcmVhdGVXcml0ZVN0cmVhbShmdWxsUmVwb3J0ZXJPdXRwdXRQYXRoKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHN0YXRpYyBfYWRkRGVmYXVsdFJlcG9ydGVyIChyZXBvcnRlcnM6IFJlcG9ydGVyU291cmNlW10pOiB2b2lkIHtcbiAgICAgICAgcmVwb3J0ZXJzLnB1c2goe1xuICAgICAgICAgICAgbmFtZTogICAnc3BlYycsXG4gICAgICAgICAgICBvdXRwdXQ6IHByb2Nlc3Muc3Rkb3V0XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgX2dldFJlcG9ydGVyUGx1Z2lucyAoKTogUHJvbWlzZTxSZXBvcnRlclBsdWdpblNvdXJjZVtdPiB7XG4gICAgICAgIGlmICghdGhpcy5yZXBvcnRlcnMubGVuZ3RoKVxuICAgICAgICAgICAgQm9vdHN0cmFwcGVyLl9hZGREZWZhdWx0UmVwb3J0ZXIodGhpcy5yZXBvcnRlcnMpO1xuXG4gICAgICAgIHJldHVybiBQcm9taXNlLmFsbCh0aGlzLnJlcG9ydGVycy5tYXAoYXN5bmMgKHsgbmFtZSwgb3V0cHV0IH0pID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHBsdWdpbkZhY3RvcnkgPSBnZXRQbHVnaW5GYWN0b3J5KG5hbWUpO1xuICAgICAgICAgICAgY29uc3QgcHJvY2Vzc2VkTmFtZSA9IHByb2Nlc3NSZXBvcnRlck5hbWUobmFtZSk7XG4gICAgICAgICAgICBjb25zdCBvdXRTdHJlYW0gICAgID0gb3V0cHV0ID8gYXdhaXQgdGhpcy5fZW5zdXJlT3V0U3RyZWFtKG91dHB1dCkgOiB2b2lkIDA7XG5cbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgcGx1Z2luOiBwbHVnaW5GYWN0b3J5KCksXG4gICAgICAgICAgICAgICAgbmFtZTogICBwcm9jZXNzZWROYW1lLFxuICAgICAgICAgICAgICAgIG91dFN0cmVhbVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfSkpO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgX3N0YXJ0VGVzdGVkQXBwICgpOiBQcm9taXNlPFRlc3RlZEFwcHx1bmRlZmluZWQ+IHtcbiAgICAgICAgaWYgKCF0aGlzLmFwcENvbW1hbmQpXG4gICAgICAgICAgICByZXR1cm4gdm9pZCAwO1xuXG4gICAgICAgIGNvbnN0IHRlc3RlZEFwcCA9IG5ldyBUZXN0ZWRBcHAoKTtcblxuICAgICAgICBhd2FpdCB0ZXN0ZWRBcHAuc3RhcnQodGhpcy5hcHBDb21tYW5kLCB0aGlzLmFwcEluaXREZWxheSBhcyBudW1iZXIpO1xuXG4gICAgICAgIHJldHVybiB0ZXN0ZWRBcHA7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBfY2FuVXNlUGFyYWxsZWxCb290c3RyYXBwaW5nIChicm93c2VySW5mbzogQnJvd3NlckluZm9Tb3VyY2VbXSk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgICAgICBjb25zdCBpc0xvY2FsUHJvbWlzZXMgPSBicm93c2VySW5mby5tYXAoYnJvd3NlciA9PiBicm93c2VyLnByb3ZpZGVyLmlzTG9jYWxCcm93c2VyKHZvaWQgMCwgQm9vdHN0cmFwcGVyLl9nZXRCcm93c2VyTmFtZShicm93c2VyKSkpO1xuICAgICAgICBjb25zdCBpc0xvY2FsQnJvd3NlcnMgPSBhd2FpdCBQcm9taXNlLmFsbChpc0xvY2FsUHJvbWlzZXMpO1xuXG4gICAgICAgIHJldHVybiBpc0xvY2FsQnJvd3NlcnMuZXZlcnkocmVzdWx0ID0+IHJlc3VsdCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBfYm9vdHN0cmFwU2VxdWVuY2UgKGJyb3dzZXJJbmZvOiBCcm93c2VySW5mb1NvdXJjZVtdKTogUHJvbWlzZTxCYXNpY1J1bnRpbWVSZXNvdXJjZXM+IHtcbiAgICAgICAgY29uc3QgdGVzdHMgICAgICAgPSBhd2FpdCB0aGlzLl9nZXRUZXN0cygpO1xuICAgICAgICBjb25zdCB0ZXN0ZWRBcHAgICA9IGF3YWl0IHRoaXMuX3N0YXJ0VGVzdGVkQXBwKCk7XG4gICAgICAgIGNvbnN0IGJyb3dzZXJTZXQgID0gYXdhaXQgdGhpcy5fZ2V0QnJvd3NlckNvbm5lY3Rpb25zKGJyb3dzZXJJbmZvKTtcblxuICAgICAgICByZXR1cm4geyB0ZXN0cywgdGVzdGVkQXBwLCBicm93c2VyU2V0IH07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfd3JhcEJvb3RzdHJhcHBpbmdQcm9taXNlPFQ+IChwcm9taXNlOiBQcm9taXNlPFQ+KTogUHJvbWlzZTxQcm9taXNlUmVzdWx0PFQ+PiB7XG4gICAgICAgIHJldHVybiBwcm9taXNlXG4gICAgICAgICAgICAudGhlbihyZXN1bHQgPT4gKHsgZXJyb3I6IHZvaWQgMCwgcmVzdWx0IH0pKVxuICAgICAgICAgICAgLmNhdGNoKGVycm9yID0+ICh7IHJlc3VsdDogdm9pZCAwLCBlcnJvciB9KSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBfZ2V0Qm9vdHN0cmFwcGluZ0Vycm9yIChicm93c2VyU2V0U3RhdHVzOiBQcm9taXNlUmVzdWx0PEJyb3dzZXJTZXQ+LCB0ZXN0c1N0YXR1czogUHJvbWlzZVJlc3VsdDxUZXN0W10+LCB0ZXN0ZWRBcHBTdGF0dXM6IFByb21pc2VSZXN1bHQ8VGVzdGVkQXBwfHVuZGVmaW5lZD4pOiBQcm9taXNlPEVycm9yPiB7XG4gICAgICAgIGlmICghaXNQcm9taXNlRXJyb3IoYnJvd3NlclNldFN0YXR1cykpXG4gICAgICAgICAgICBhd2FpdCBicm93c2VyU2V0U3RhdHVzLnJlc3VsdC5kaXNwb3NlKCk7XG5cbiAgICAgICAgaWYgKCFpc1Byb21pc2VFcnJvcihicm93c2VyU2V0U3RhdHVzKSAmJiAhaXNQcm9taXNlRXJyb3IodGVzdGVkQXBwU3RhdHVzKSAmJiB0ZXN0ZWRBcHBTdGF0dXMucmVzdWx0KVxuICAgICAgICAgICAgYXdhaXQgdGVzdGVkQXBwU3RhdHVzLnJlc3VsdC5raWxsKCk7XG5cbiAgICAgICAgaWYgKGlzUHJvbWlzZUVycm9yKHRlc3RzU3RhdHVzKSlcbiAgICAgICAgICAgIHJldHVybiB0ZXN0c1N0YXR1cy5lcnJvcjtcblxuICAgICAgICBpZiAoaXNQcm9taXNlRXJyb3IodGVzdGVkQXBwU3RhdHVzKSlcbiAgICAgICAgICAgIHJldHVybiB0ZXN0ZWRBcHBTdGF0dXMuZXJyb3I7XG5cbiAgICAgICAgaWYgKGlzUHJvbWlzZUVycm9yKGJyb3dzZXJTZXRTdGF0dXMpKVxuICAgICAgICAgICAgcmV0dXJuIGJyb3dzZXJTZXRTdGF0dXMuZXJyb3I7XG5cbiAgICAgICAgcmV0dXJuIG5ldyBFcnJvcignVW5leHBlY3RlZCBjYWxsJyk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfZ2V0Qm9vdHN0cmFwcGluZ1Byb21pc2VzPFQ+IChhcmc6IFByb21pc2VDb2xsZWN0aW9uPFQ+KTogUHJvbWlzZUNvbGxlY3Rpb248UmVzdWx0Q29sbGVjdGlvbjxUPj4ge1xuICAgICAgICBjb25zdCByZXN1bHQgPSB7fSBhcyB1bmtub3duIGFzIFByb21pc2VDb2xsZWN0aW9uPFJlc3VsdENvbGxlY3Rpb248VD4+O1xuXG4gICAgICAgIGZvciAoY29uc3QgayBpbiBhcmcpXG4gICAgICAgICAgICByZXN1bHRba10gPSB0aGlzLl93cmFwQm9vdHN0cmFwcGluZ1Byb21pc2UoYXJnW2tdKTtcblxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgX2Jvb3RzdHJhcFBhcmFsbGVsIChicm93c2VySW5mbzogQnJvd3NlckluZm9Tb3VyY2VbXSk6IFByb21pc2U8QmFzaWNSdW50aW1lUmVzb3VyY2VzPiB7XG4gICAgICAgIGNvbnN0IGJvb3RzdHJhcHBpbmdQcm9taXNlcyA9IHtcbiAgICAgICAgICAgIGJyb3dzZXJTZXQ6IHRoaXMuX2dldEJyb3dzZXJDb25uZWN0aW9ucyhicm93c2VySW5mbyksXG4gICAgICAgICAgICB0ZXN0czogICAgICB0aGlzLl9nZXRUZXN0cygpLFxuICAgICAgICAgICAgYXBwOiAgICAgICAgdGhpcy5fc3RhcnRUZXN0ZWRBcHAoKVxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IGJvb3RzdHJhcHBpbmdSZXN1bHRQcm9taXNlcyA9IHRoaXMuX2dldEJvb3RzdHJhcHBpbmdQcm9taXNlcyhib290c3RyYXBwaW5nUHJvbWlzZXMpO1xuXG4gICAgICAgIGNvbnN0IGJvb3RzdHJhcHBpbmdSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgICAgICAgYm9vdHN0cmFwcGluZ1Jlc3VsdFByb21pc2VzLmJyb3dzZXJTZXQsXG4gICAgICAgICAgICBib290c3RyYXBwaW5nUmVzdWx0UHJvbWlzZXMudGVzdHMsXG4gICAgICAgICAgICBib290c3RyYXBwaW5nUmVzdWx0UHJvbWlzZXMuYXBwXG4gICAgICAgIF0pO1xuXG4gICAgICAgIGNvbnN0IFticm93c2VyU2V0UmVzdWx0cywgdGVzdFJlc3VsdHMsIGFwcFJlc3VsdHNdID0gYm9vdHN0cmFwcGluZ1Jlc3VsdHM7XG5cbiAgICAgICAgaWYgKGlzUHJvbWlzZUVycm9yKGJyb3dzZXJTZXRSZXN1bHRzKSB8fCBpc1Byb21pc2VFcnJvcih0ZXN0UmVzdWx0cykgfHwgaXNQcm9taXNlRXJyb3IoYXBwUmVzdWx0cykpXG4gICAgICAgICAgICB0aHJvdyBhd2FpdCB0aGlzLl9nZXRCb290c3RyYXBwaW5nRXJyb3IoLi4uYm9vdHN0cmFwcGluZ1Jlc3VsdHMpO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBicm93c2VyU2V0OiBicm93c2VyU2V0UmVzdWx0cy5yZXN1bHQsXG4gICAgICAgICAgICB0ZXN0czogICAgICB0ZXN0UmVzdWx0cy5yZXN1bHQsXG4gICAgICAgICAgICB0ZXN0ZWRBcHA6ICBhcHBSZXN1bHRzLnJlc3VsdFxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIEFQSVxuICAgIHB1YmxpYyBhc3luYyBjcmVhdGVSdW5uYWJsZUNvbmZpZ3VyYXRpb24gKCk6IFByb21pc2U8UnVudGltZVJlc291cmNlcz4ge1xuICAgICAgICBjb25zdCByZXBvcnRlclBsdWdpbnMgICAgID0gYXdhaXQgdGhpcy5fZ2V0UmVwb3J0ZXJQbHVnaW5zKCk7XG4gICAgICAgIGNvbnN0IGNvbW1vbkNsaWVudFNjcmlwdHMgPSBhd2FpdCBsb2FkQ2xpZW50U2NyaXB0cyh0aGlzLmNsaWVudFNjcmlwdHMpO1xuXG4gICAgICAgIC8vIE5PVEU6IElmIGEgdXNlciBmb3Jnb3QgdG8gc3BlY2lmeSBhIGJyb3dzZXIsIGJ1dCBoYXMgc3BlY2lmaWVkIGEgcGF0aCB0byB0ZXN0cywgdGhlIHNwZWNpZmllZCBwYXRoIHdpbGwgYmVcbiAgICAgICAgLy8gY29uc2lkZXJlZCBhcyB0aGUgYnJvd3NlciBhcmd1bWVudCwgYW5kIHRoZSB0ZXN0cyBwYXRoIGFyZ3VtZW50IHdpbGwgaGF2ZSB0aGUgcHJlZGVmaW5lZCBkZWZhdWx0IHZhbHVlLlxuICAgICAgICAvLyBJdCdzIHZlcnkgYW1iaWd1b3VzIGZvciB0aGUgdXNlciwgd2hvIG1pZ2h0IGJlIGNvbmZ1c2VkIGJ5IGNvbXBpbGF0aW9uIGVycm9ycyBmcm9tIGFuIHVuZXhwZWN0ZWQgdGVzdC5cbiAgICAgICAgLy8gU28sIHdlIG5lZWQgdG8gcmV0cmlldmUgdGhlIGJyb3dzZXIgYWxpYXNlcyBhbmQgcGF0aHMgYmVmb3JlIHRlc3RzIGNvbXBpbGF0aW9uLlxuICAgICAgICBjb25zdCBicm93c2VySW5mbyA9IGF3YWl0IHRoaXMuX2dldEJyb3dzZXJJbmZvKCk7XG5cbiAgICAgICAgaWYgKE9TLm1hYylcbiAgICAgICAgICAgIGF3YWl0IEJvb3RzdHJhcHBlci5fY2hlY2tSZXF1aXJlZFBlcm1pc3Npb25zKGJyb3dzZXJJbmZvKTtcblxuICAgICAgICBpZiAoT1MubGludXggJiYgIWRldGVjdERpc3BsYXkoKSlcbiAgICAgICAgICAgIGF3YWl0IEJvb3RzdHJhcHBlci5fY2hlY2tUaGF0VGVzdHNDYW5SdW5XaXRob3V0RGlzcGxheShicm93c2VySW5mbyk7XG5cbiAgICAgICAgaWYgKGF3YWl0IHRoaXMuX2NhblVzZVBhcmFsbGVsQm9vdHN0cmFwcGluZyhicm93c2VySW5mbykpXG4gICAgICAgICAgICByZXR1cm4geyByZXBvcnRlclBsdWdpbnMsIC4uLmF3YWl0IHRoaXMuX2Jvb3RzdHJhcFBhcmFsbGVsKGJyb3dzZXJJbmZvKSwgY29tbW9uQ2xpZW50U2NyaXB0cyB9O1xuXG4gICAgICAgIHJldHVybiB7IHJlcG9ydGVyUGx1Z2lucywgLi4uYXdhaXQgdGhpcy5fYm9vdHN0cmFwU2VxdWVuY2UoYnJvd3NlckluZm8pLCBjb21tb25DbGllbnRTY3JpcHRzIH07XG4gICAgfVxufVxuIl19