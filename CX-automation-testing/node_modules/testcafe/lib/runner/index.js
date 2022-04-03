"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const debug_1 = __importDefault(require("debug"));
const promisify_event_1 = __importDefault(require("promisify-event"));
const map_reverse_1 = __importDefault(require("map-reverse"));
const events_1 = require("events");
const lodash_1 = require("lodash");
const bootstrapper_1 = __importDefault(require("./bootstrapper"));
const reporter_1 = __importDefault(require("../reporter"));
const task_1 = __importDefault(require("./task"));
const debug_logger_1 = __importDefault(require("../notifications/debug-logger"));
const runtime_1 = require("../errors/runtime");
const types_1 = require("../errors/types");
const type_assertions_1 = require("../errors/runtime/type-assertions");
const utils_1 = require("../errors/test-run/utils");
const detect_ffmpeg_1 = __importDefault(require("../utils/detect-ffmpeg"));
const check_file_path_1 = __importDefault(require("../utils/check-file-path"));
const handle_errors_1 = require("../utils/handle-errors");
const option_names_1 = __importDefault(require("../configuration/option-names"));
const flag_list_1 = __importDefault(require("../utils/flag-list"));
const prepare_reporters_1 = __importDefault(require("../utils/prepare-reporters"));
const load_1 = __importDefault(require("../custom-client-scripts/load"));
const utils_2 = require("../custom-client-scripts/utils");
const reporter_stream_controller_1 = __importDefault(require("./reporter-stream-controller"));
const DEBUG_LOGGER = debug_1.default('testcafe:runner');
class Runner extends events_1.EventEmitter {
    constructor(proxy, browserConnectionGateway, configuration, compilerService) {
        super();
        this.proxy = proxy;
        this.bootstrapper = this._createBootstrapper(browserConnectionGateway, compilerService);
        this.pendingTaskPromises = [];
        this.configuration = configuration;
        this.isCli = false;
        this.apiMethodWasCalled = new flag_list_1.default([
            option_names_1.default.src,
            option_names_1.default.browsers,
            option_names_1.default.reporter,
            option_names_1.default.clientScripts
        ]);
    }
    _createBootstrapper(browserConnectionGateway, compilerService) {
        return new bootstrapper_1.default(browserConnectionGateway, compilerService);
    }
    _disposeBrowserSet(browserSet) {
        return browserSet.dispose().catch(e => DEBUG_LOGGER(e));
    }
    _disposeReporters(reporters) {
        return Promise.all(reporters.map(reporter => reporter.dispose().catch(e => DEBUG_LOGGER(e))));
    }
    _disposeTestedApp(testedApp) {
        return testedApp ? testedApp.kill().catch(e => DEBUG_LOGGER(e)) : Promise.resolve();
    }
    async _disposeTaskAndRelatedAssets(task, browserSet, reporters, testedApp) {
        task.abort();
        task.unRegisterClientScriptRouting();
        task.clearListeners();
        await this._disposeAssets(browserSet, reporters, testedApp);
    }
    _disposeAssets(browserSet, reporters, testedApp) {
        return Promise.all([
            this._disposeBrowserSet(browserSet),
            this._disposeReporters(reporters),
            this._disposeTestedApp(testedApp)
        ]);
    }
    _prepareArrayParameter(array) {
        array = lodash_1.flattenDeep(array);
        if (this.isCli)
            return array.length === 0 ? void 0 : array;
        return array;
    }
    _createCancelablePromise(taskPromise) {
        const promise = taskPromise.then(({ completionPromise }) => completionPromise);
        const removeFromPending = () => lodash_1.pull(this.pendingTaskPromises, promise);
        promise
            .then(removeFromPending)
            .catch(removeFromPending);
        promise.cancel = () => taskPromise
            .then(({ cancelTask }) => cancelTask())
            .then(removeFromPending);
        this.pendingTaskPromises.push(promise);
        return promise;
    }
    // Run task
    _getFailedTestCount(task, reporter) {
        let failedTestCount = reporter.testCount - reporter.passed;
        if (task.opts.stopOnFirstFail && !!failedTestCount)
            failedTestCount = 1;
        return failedTestCount;
    }
    async _getTaskResult(task, browserSet, reporters, testedApp) {
        if (!task.opts.live) {
            task.on('browser-job-done', job => {
                job.browserConnections.forEach(bc => browserSet.releaseConnection(bc));
            });
        }
        const browserSetErrorPromise = promisify_event_1.default(browserSet, 'error');
        const taskErrorPromise = promisify_event_1.default(task, 'error');
        const streamController = new reporter_stream_controller_1.default(task, reporters);
        const taskDonePromise = task.once('done')
            .then(() => browserSetErrorPromise.cancel())
            .then(() => {
            return Promise.all(reporters.map(reporter => reporter.pendingTaskDonePromise));
        });
        const promises = [
            taskDonePromise,
            browserSetErrorPromise,
            taskErrorPromise
        ];
        if (testedApp)
            promises.push(testedApp.errorPromise);
        try {
            await Promise.race(promises);
        }
        catch (err) {
            await this._disposeTaskAndRelatedAssets(task, browserSet, reporters, testedApp);
            throw err;
        }
        await this._disposeAssets(browserSet, reporters, testedApp);
        if (streamController.multipleStreamError)
            throw streamController.multipleStreamError;
        return this._getFailedTestCount(task, reporters[0]);
    }
    _createTask(tests, browserConnectionGroups, proxy, opts) {
        return new task_1.default(tests, browserConnectionGroups, proxy, opts);
    }
    _runTask(reporterPlugins, browserSet, tests, testedApp) {
        const task = this._createTask(tests, browserSet.browserConnectionGroups, this.proxy, this.configuration.getOptions());
        const reporters = reporterPlugins.map(reporter => new reporter_1.default(reporter.plugin, task, reporter.outStream, reporter.name));
        const completionPromise = this._getTaskResult(task, browserSet, reporters, testedApp);
        let completed = false;
        task.on('start', handle_errors_1.startHandlingTestErrors);
        if (!this.configuration.getOption(option_names_1.default.skipUncaughtErrors)) {
            task.on('test-run-start', handle_errors_1.addRunningTest);
            task.on('test-run-done', handle_errors_1.removeRunningTest);
        }
        task.on('done', handle_errors_1.stopHandlingTestErrors);
        task.on('error', handle_errors_1.stopHandlingTestErrors);
        const onTaskCompleted = () => {
            task.unRegisterClientScriptRouting();
            completed = true;
        };
        completionPromise
            .then(onTaskCompleted)
            .catch(onTaskCompleted);
        const cancelTask = async () => {
            if (!completed)
                await this._disposeTaskAndRelatedAssets(task, browserSet, reporters, testedApp);
        };
        return { completionPromise, cancelTask };
    }
    _registerAssets(assets) {
        assets.forEach(asset => this.proxy.GET(asset.path, asset.info));
    }
    _validateDebugLogger() {
        const debugLogger = this.configuration.getOption(option_names_1.default.debugLogger);
        const debugLoggerDefinedCorrectly = debugLogger === null || !!debugLogger &&
            ['showBreakpoint', 'hideBreakpoint'].every(method => method in debugLogger && lodash_1.isFunction(debugLogger[method]));
        if (!debugLoggerDefinedCorrectly) {
            this.configuration.mergeOptions({
                [option_names_1.default.debugLogger]: debug_logger_1.default
            });
        }
    }
    _validateSpeedOption() {
        const speed = this.configuration.getOption(option_names_1.default.speed);
        if (speed === void 0)
            return;
        if (typeof speed !== 'number' || isNaN(speed) || speed < 0.01 || speed > 1)
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.invalidSpeedValue);
    }
    _validateConcurrencyOption() {
        const concurrency = this.configuration.getOption(option_names_1.default.concurrency);
        if (concurrency === void 0)
            return;
        if (typeof concurrency !== 'number' || isNaN(concurrency) || concurrency < 1)
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.invalidConcurrencyFactor);
    }
    _validateProxyBypassOption() {
        let proxyBypass = this.configuration.getOption(option_names_1.default.proxyBypass);
        if (proxyBypass === void 0)
            return;
        type_assertions_1.assertType([type_assertions_1.is.string, type_assertions_1.is.array], null, '"proxyBypass" argument', proxyBypass);
        if (typeof proxyBypass === 'string')
            proxyBypass = [proxyBypass];
        proxyBypass = proxyBypass.reduce((arr, rules) => {
            type_assertions_1.assertType(type_assertions_1.is.string, null, '"proxyBypass" argument', rules);
            return arr.concat(rules.split(','));
        }, []);
        this.configuration.mergeOptions({ proxyBypass });
    }
    _getScreenshotOptions() {
        let { path, pathPattern } = this.configuration.getOption(option_names_1.default.screenshots) || {};
        if (!path)
            path = this.configuration.getOption(option_names_1.default.screenshotPath);
        if (!pathPattern)
            pathPattern = this.configuration.getOption(option_names_1.default.screenshotPathPattern);
        return { path, pathPattern };
    }
    _validateScreenshotOptions() {
        const { path, pathPattern } = this._getScreenshotOptions();
        const disableScreenshots = this.configuration.getOption(option_names_1.default.disableScreenshots) || !path;
        this.configuration.mergeOptions({ [option_names_1.default.disableScreenshots]: disableScreenshots });
        if (disableScreenshots)
            return;
        if (path) {
            this._validateScreenshotPath(path, 'screenshots base directory path');
            this.configuration.mergeOptions({ [option_names_1.default.screenshots]: { path: path_1.resolve(path) } });
        }
        if (pathPattern) {
            this._validateScreenshotPath(pathPattern, 'screenshots path pattern');
            this.configuration.mergeOptions({ [option_names_1.default.screenshots]: { pathPattern } });
        }
    }
    async _validateVideoOptions() {
        const videoPath = this.configuration.getOption(option_names_1.default.videoPath);
        const videoEncodingOptions = this.configuration.getOption(option_names_1.default.videoEncodingOptions);
        let videoOptions = this.configuration.getOption(option_names_1.default.videoOptions);
        if (!videoPath) {
            if (videoOptions || videoEncodingOptions)
                throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.cannotSetVideoOptionsWithoutBaseVideoPathSpecified);
            return;
        }
        this.configuration.mergeOptions({ [option_names_1.default.videoPath]: path_1.resolve(videoPath) });
        if (!videoOptions) {
            videoOptions = {};
            this.configuration.mergeOptions({ [option_names_1.default.videoOptions]: videoOptions });
        }
        if (videoOptions.ffmpegPath)
            videoOptions.ffmpegPath = path_1.resolve(videoOptions.ffmpegPath);
        else
            videoOptions.ffmpegPath = await detect_ffmpeg_1.default();
        if (!videoOptions.ffmpegPath)
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.cannotFindFFMPEG);
    }
    async _validateRunOptions() {
        this._validateDebugLogger();
        this._validateScreenshotOptions();
        await this._validateVideoOptions();
        this._validateSpeedOption();
        this._validateConcurrencyOption();
        this._validateProxyBypassOption();
    }
    _createRunnableConfiguration() {
        return this.bootstrapper
            .createRunnableConfiguration()
            .then(runnableConfiguration => {
            this.emit('done-bootstrapping');
            return runnableConfiguration;
        });
    }
    _validateScreenshotPath(screenshotPath, pathType) {
        const forbiddenCharsList = check_file_path_1.default(screenshotPath);
        if (forbiddenCharsList.length)
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.forbiddenCharatersInScreenshotPath, screenshotPath, pathType, utils_1.renderForbiddenCharsList(forbiddenCharsList));
    }
    _setBootstrapperOptions() {
        this.configuration.prepare();
        this.configuration.notifyAboutOverriddenOptions();
        this.bootstrapper.sources = this.configuration.getOption(option_names_1.default.src) || this.bootstrapper.sources;
        this.bootstrapper.browsers = this.configuration.getOption(option_names_1.default.browsers) || this.bootstrapper.browsers;
        this.bootstrapper.concurrency = this.configuration.getOption(option_names_1.default.concurrency);
        this.bootstrapper.appCommand = this.configuration.getOption(option_names_1.default.appCommand) || this.bootstrapper.appCommand;
        this.bootstrapper.appInitDelay = this.configuration.getOption(option_names_1.default.appInitDelay);
        this.bootstrapper.filter = this.configuration.getOption(option_names_1.default.filter) || this.bootstrapper.filter;
        this.bootstrapper.reporters = this.configuration.getOption(option_names_1.default.reporter) || this.bootstrapper.reporters;
        this.bootstrapper.tsConfigPath = this.configuration.getOption(option_names_1.default.tsConfigPath);
        this.bootstrapper.clientScripts = this.configuration.getOption(option_names_1.default.clientScripts) || this.bootstrapper.clientScripts;
        this.bootstrapper.disableMultipleWindows = this.configuration.getOption(option_names_1.default.disableMultipleWindows);
    }
    // API
    embeddingOptions(opts) {
        const { assets, TestRunCtor } = opts;
        this._registerAssets(assets);
        this.configuration.mergeOptions({ TestRunCtor });
        return this;
    }
    src(...sources) {
        if (this.apiMethodWasCalled.src)
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.multipleAPIMethodCallForbidden, option_names_1.default.src);
        sources = this._prepareArrayParameter(sources);
        this.configuration.mergeOptions({ [option_names_1.default.src]: sources });
        this.apiMethodWasCalled.src = true;
        return this;
    }
    browsers(...browsers) {
        if (this.apiMethodWasCalled.browsers)
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.multipleAPIMethodCallForbidden, option_names_1.default.browsers);
        browsers = this._prepareArrayParameter(browsers);
        this.configuration.mergeOptions({ browsers });
        this.apiMethodWasCalled.browsers = true;
        return this;
    }
    concurrency(concurrency) {
        this.configuration.mergeOptions({ concurrency });
        return this;
    }
    reporter(name, output) {
        if (this.apiMethodWasCalled.reporter)
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.multipleAPIMethodCallForbidden, option_names_1.default.reporter);
        let reporters = prepare_reporters_1.default(name, output);
        reporters = this._prepareArrayParameter(reporters);
        this.configuration.mergeOptions({ [option_names_1.default.reporter]: reporters });
        this.apiMethodWasCalled.reporter = true;
        return this;
    }
    filter(filter) {
        this.configuration.mergeOptions({ filter });
        return this;
    }
    useProxy(proxy, proxyBypass) {
        this.configuration.mergeOptions({ proxy, proxyBypass });
        return this;
    }
    screenshots(...options) {
        let fullPage;
        let [path, takeOnFails, pathPattern] = options;
        if (options.length === 1 && options[0] && typeof options[0] === 'object')
            ({ path, takeOnFails, pathPattern, fullPage } = options[0]);
        this.configuration.mergeOptions({ screenshots: { path, takeOnFails, pathPattern, fullPage } });
        return this;
    }
    video(path, options, encodingOptions) {
        this.configuration.mergeOptions({
            [option_names_1.default.videoPath]: path,
            [option_names_1.default.videoOptions]: options,
            [option_names_1.default.videoEncodingOptions]: encodingOptions
        });
        return this;
    }
    startApp(command, initDelay) {
        this.configuration.mergeOptions({
            [option_names_1.default.appCommand]: command,
            [option_names_1.default.appInitDelay]: initDelay
        });
        return this;
    }
    tsConfigPath(path) {
        this.configuration.mergeOptions({
            [option_names_1.default.tsConfigPath]: path
        });
        return this;
    }
    clientScripts(...scripts) {
        if (this.apiMethodWasCalled.clientScripts)
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.multipleAPIMethodCallForbidden, option_names_1.default.clientScripts);
        scripts = this._prepareArrayParameter(scripts);
        this.configuration.mergeOptions({ [option_names_1.default.clientScripts]: scripts });
        this.apiMethodWasCalled.clientScripts = true;
        return this;
    }
    async _prepareClientScripts(tests, clientScripts) {
        return Promise.all(tests.map(async (test) => {
            if (test.isLegacy)
                return;
            let loadedTestClientScripts = await load_1.default(test.clientScripts, path_1.dirname(test.testFile.filename));
            loadedTestClientScripts = clientScripts.concat(loadedTestClientScripts);
            test.clientScripts = utils_2.setUniqueUrls(loadedTestClientScripts);
        }));
    }
    run(options = {}) {
        this.apiMethodWasCalled.reset();
        this.configuration.mergeOptions(options);
        this._setBootstrapperOptions();
        const runTaskPromise = Promise.resolve()
            .then(() => this._validateRunOptions())
            .then(() => this._createRunnableConfiguration())
            .then(async ({ reporterPlugins, browserSet, tests, testedApp, commonClientScripts }) => {
            await this._prepareClientScripts(tests, commonClientScripts);
            return this._runTask(reporterPlugins, browserSet, tests, testedApp);
        });
        return this._createCancelablePromise(runTaskPromise);
    }
    async stop() {
        // NOTE: When taskPromise is cancelled, it is removed from
        // the pendingTaskPromises array, which leads to shifting indexes
        // towards the beginning. So, we must copy the array in order to iterate it,
        // or we can perform iteration from the end to the beginning.
        const cancellationPromises = map_reverse_1.default(this.pendingTaskPromises, taskPromise => taskPromise.cancel());
        await Promise.all(cancellationPromises);
    }
}
exports.default = Runner;
module.exports = exports.default;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvcnVubmVyL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBQUEsK0JBQXVEO0FBQ3ZELGtEQUEwQjtBQUMxQixzRUFBNkM7QUFDN0MsOERBQXFDO0FBQ3JDLG1DQUFzQztBQUN0QyxtQ0FJZ0I7QUFFaEIsa0VBQTBDO0FBQzFDLDJEQUFtQztBQUNuQyxrREFBMEI7QUFDMUIsaUZBQStEO0FBQy9ELCtDQUFpRDtBQUNqRCwyQ0FBaUQ7QUFDakQsdUVBQW1FO0FBQ25FLG9EQUFvRTtBQUNwRSwyRUFBa0Q7QUFDbEQsK0VBQXFEO0FBQ3JELDBEQUtnQztBQUVoQyxpRkFBeUQ7QUFDekQsbUVBQTBDO0FBQzFDLG1GQUEwRDtBQUMxRCx5RUFBOEQ7QUFDOUQsMERBQStEO0FBQy9ELDhGQUFvRTtBQUVwRSxNQUFNLFlBQVksR0FBRyxlQUFLLENBQUMsaUJBQWlCLENBQUMsQ0FBQztBQUU5QyxNQUFxQixNQUFPLFNBQVEscUJBQVk7SUFDNUMsWUFBYSxLQUFLLEVBQUUsd0JBQXdCLEVBQUUsYUFBYSxFQUFFLGVBQWU7UUFDeEUsS0FBSyxFQUFFLENBQUM7UUFFUixJQUFJLENBQUMsS0FBSyxHQUFpQixLQUFLLENBQUM7UUFDakMsSUFBSSxDQUFDLFlBQVksR0FBVSxJQUFJLENBQUMsbUJBQW1CLENBQUMsd0JBQXdCLEVBQUUsZUFBZSxDQUFDLENBQUM7UUFDL0YsSUFBSSxDQUFDLG1CQUFtQixHQUFHLEVBQUUsQ0FBQztRQUM5QixJQUFJLENBQUMsYUFBYSxHQUFTLGFBQWEsQ0FBQztRQUN6QyxJQUFJLENBQUMsS0FBSyxHQUFpQixLQUFLLENBQUM7UUFFakMsSUFBSSxDQUFDLGtCQUFrQixHQUFHLElBQUksbUJBQVEsQ0FBQztZQUNuQyxzQkFBWSxDQUFDLEdBQUc7WUFDaEIsc0JBQVksQ0FBQyxRQUFRO1lBQ3JCLHNCQUFZLENBQUMsUUFBUTtZQUNyQixzQkFBWSxDQUFDLGFBQWE7U0FDN0IsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztJQUVELG1CQUFtQixDQUFFLHdCQUF3QixFQUFFLGVBQWU7UUFDMUQsT0FBTyxJQUFJLHNCQUFZLENBQUMsd0JBQXdCLEVBQUUsZUFBZSxDQUFDLENBQUM7SUFDdkUsQ0FBQztJQUVELGtCQUFrQixDQUFFLFVBQVU7UUFDMUIsT0FBTyxVQUFVLENBQUMsT0FBTyxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDNUQsQ0FBQztJQUVELGlCQUFpQixDQUFFLFNBQVM7UUFDeEIsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ2xHLENBQUM7SUFFRCxpQkFBaUIsQ0FBRSxTQUFTO1FBQ3hCLE9BQU8sU0FBUyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztJQUN4RixDQUFDO0lBRUQsS0FBSyxDQUFDLDRCQUE0QixDQUFFLElBQUksRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLFNBQVM7UUFDdEUsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ2IsSUFBSSxDQUFDLDZCQUE2QixFQUFFLENBQUM7UUFDckMsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBRXRCLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxVQUFVLEVBQUUsU0FBUyxFQUFFLFNBQVMsQ0FBQyxDQUFDO0lBQ2hFLENBQUM7SUFFRCxjQUFjLENBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRSxTQUFTO1FBQzVDLE9BQU8sT0FBTyxDQUFDLEdBQUcsQ0FBQztZQUNmLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxVQUFVLENBQUM7WUFDbkMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFNBQVMsQ0FBQztZQUNqQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsU0FBUyxDQUFDO1NBQ3BDLENBQUMsQ0FBQztJQUNQLENBQUM7SUFFRCxzQkFBc0IsQ0FBRSxLQUFLO1FBQ3pCLEtBQUssR0FBRyxvQkFBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBRXZCLElBQUksSUFBSSxDQUFDLEtBQUs7WUFDVixPQUFPLEtBQUssQ0FBQyxNQUFNLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDO1FBRS9DLE9BQU8sS0FBSyxDQUFDO0lBQ2pCLENBQUM7SUFFRCx3QkFBd0IsQ0FBRSxXQUFXO1FBQ2pDLE1BQU0sT0FBTyxHQUFhLFdBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxFQUFFLGlCQUFpQixFQUFFLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDLENBQUM7UUFDekYsTUFBTSxpQkFBaUIsR0FBRyxHQUFHLEVBQUUsQ0FBQyxhQUFNLENBQUMsSUFBSSxDQUFDLG1CQUFtQixFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBRTFFLE9BQU87YUFDRixJQUFJLENBQUMsaUJBQWlCLENBQUM7YUFDdkIsS0FBSyxDQUFDLGlCQUFpQixDQUFDLENBQUM7UUFFOUIsT0FBTyxDQUFDLE1BQU0sR0FBRyxHQUFHLEVBQUUsQ0FBQyxXQUFXO2FBQzdCLElBQUksQ0FBQyxDQUFDLEVBQUUsVUFBVSxFQUFFLEVBQUUsRUFBRSxDQUFDLFVBQVUsRUFBRSxDQUFDO2FBQ3RDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO1FBRTdCLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7UUFFdkMsT0FBTyxPQUFPLENBQUM7SUFDbkIsQ0FBQztJQUVELFdBQVc7SUFDWCxtQkFBbUIsQ0FBRSxJQUFJLEVBQUUsUUFBUTtRQUMvQixJQUFJLGVBQWUsR0FBRyxRQUFRLENBQUMsU0FBUyxHQUFHLFFBQVEsQ0FBQyxNQUFNLENBQUM7UUFFM0QsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLGVBQWUsSUFBSSxDQUFDLENBQUMsZUFBZTtZQUM5QyxlQUFlLEdBQUcsQ0FBQyxDQUFDO1FBRXhCLE9BQU8sZUFBZSxDQUFDO0lBQzNCLENBQUM7SUFFRCxLQUFLLENBQUMsY0FBYyxDQUFFLElBQUksRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLFNBQVM7UUFDeEQsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFO1lBQ2pCLElBQUksQ0FBQyxFQUFFLENBQUMsa0JBQWtCLEVBQUUsR0FBRyxDQUFDLEVBQUU7Z0JBQzlCLEdBQUcsQ0FBQyxrQkFBa0IsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxVQUFVLENBQUMsaUJBQWlCLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztZQUMzRSxDQUFDLENBQUMsQ0FBQztTQUNOO1FBRUQsTUFBTSxzQkFBc0IsR0FBRyx5QkFBYyxDQUFDLFVBQVUsRUFBRSxPQUFPLENBQUMsQ0FBQztRQUNuRSxNQUFNLGdCQUFnQixHQUFTLHlCQUFjLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBQzdELE1BQU0sZ0JBQWdCLEdBQVMsSUFBSSxvQ0FBd0IsQ0FBQyxJQUFJLEVBQUUsU0FBUyxDQUFDLENBQUM7UUFFN0UsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUM7YUFDcEMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLHNCQUFzQixDQUFDLE1BQU0sRUFBRSxDQUFDO2FBQzNDLElBQUksQ0FBQyxHQUFHLEVBQUU7WUFDUCxPQUFPLE9BQU8sQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLENBQUM7UUFDbkYsQ0FBQyxDQUFDLENBQUM7UUFFUCxNQUFNLFFBQVEsR0FBRztZQUNiLGVBQWU7WUFDZixzQkFBc0I7WUFDdEIsZ0JBQWdCO1NBQ25CLENBQUM7UUFFRixJQUFJLFNBQVM7WUFDVCxRQUFRLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUUxQyxJQUFJO1lBQ0EsTUFBTSxPQUFPLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1NBQ2hDO1FBQ0QsT0FBTyxHQUFHLEVBQUU7WUFDUixNQUFNLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxJQUFJLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRSxTQUFTLENBQUMsQ0FBQztZQUVoRixNQUFNLEdBQUcsQ0FBQztTQUNiO1FBRUQsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDLFVBQVUsRUFBRSxTQUFTLEVBQUUsU0FBUyxDQUFDLENBQUM7UUFFNUQsSUFBSSxnQkFBZ0IsQ0FBQyxtQkFBbUI7WUFDcEMsTUFBTSxnQkFBZ0IsQ0FBQyxtQkFBbUIsQ0FBQztRQUUvQyxPQUFPLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLEVBQUUsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDeEQsQ0FBQztJQUVELFdBQVcsQ0FBRSxLQUFLLEVBQUUsdUJBQXVCLEVBQUUsS0FBSyxFQUFFLElBQUk7UUFDcEQsT0FBTyxJQUFJLGNBQUksQ0FBQyxLQUFLLEVBQUUsdUJBQXVCLEVBQUUsS0FBSyxFQUFFLElBQUksQ0FBQyxDQUFDO0lBQ2pFLENBQUM7SUFFRCxRQUFRLENBQUUsZUFBZSxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsU0FBUztRQUNuRCxNQUFNLElBQUksR0FBZ0IsSUFBSSxDQUFDLFdBQVcsQ0FBQyxLQUFLLEVBQUUsVUFBVSxDQUFDLHVCQUF1QixFQUFFLElBQUksQ0FBQyxLQUFLLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO1FBQ25JLE1BQU0sU0FBUyxHQUFXLGVBQWUsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxJQUFJLGtCQUFRLENBQUMsUUFBUSxDQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFDLFNBQVMsRUFBRSxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztRQUNsSSxNQUFNLGlCQUFpQixHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLFVBQVUsRUFBRSxTQUFTLEVBQUUsU0FBUyxDQUFDLENBQUM7UUFDdEYsSUFBSSxTQUFTLEdBQWEsS0FBSyxDQUFDO1FBRWhDLElBQUksQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLHVDQUF1QixDQUFDLENBQUM7UUFFMUMsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsU0FBUyxDQUFDLHNCQUFZLENBQUMsa0JBQWtCLENBQUMsRUFBRTtZQUNoRSxJQUFJLENBQUMsRUFBRSxDQUFDLGdCQUFnQixFQUFFLDhCQUFjLENBQUMsQ0FBQztZQUMxQyxJQUFJLENBQUMsRUFBRSxDQUFDLGVBQWUsRUFBRSxpQ0FBaUIsQ0FBQyxDQUFDO1NBQy9DO1FBRUQsSUFBSSxDQUFDLEVBQUUsQ0FBQyxNQUFNLEVBQUUsc0NBQXNCLENBQUMsQ0FBQztRQUV4QyxJQUFJLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxzQ0FBc0IsQ0FBQyxDQUFDO1FBRXpDLE1BQU0sZUFBZSxHQUFHLEdBQUcsRUFBRTtZQUN6QixJQUFJLENBQUMsNkJBQTZCLEVBQUUsQ0FBQztZQUVyQyxTQUFTLEdBQUcsSUFBSSxDQUFDO1FBQ3JCLENBQUMsQ0FBQztRQUVGLGlCQUFpQjthQUNaLElBQUksQ0FBQyxlQUFlLENBQUM7YUFDckIsS0FBSyxDQUFDLGVBQWUsQ0FBQyxDQUFDO1FBRTVCLE1BQU0sVUFBVSxHQUFHLEtBQUssSUFBSSxFQUFFO1lBQzFCLElBQUksQ0FBQyxTQUFTO2dCQUNWLE1BQU0sSUFBSSxDQUFDLDRCQUE0QixDQUFDLElBQUksRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLFNBQVMsQ0FBQyxDQUFDO1FBQ3hGLENBQUMsQ0FBQztRQUVGLE9BQU8sRUFBRSxpQkFBaUIsRUFBRSxVQUFVLEVBQUUsQ0FBQztJQUM3QyxDQUFDO0lBRUQsZUFBZSxDQUFFLE1BQU07UUFDbkIsTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7SUFDcEUsQ0FBQztJQUVELG9CQUFvQjtRQUNoQixNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVMsQ0FBQyxzQkFBWSxDQUFDLFdBQVcsQ0FBQyxDQUFDO1FBRTNFLE1BQU0sMkJBQTJCLEdBQUcsV0FBVyxLQUFLLElBQUksSUFBSSxDQUFDLENBQUMsV0FBVztZQUNyRSxDQUFDLGdCQUFnQixFQUFFLGdCQUFnQixDQUFDLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsTUFBTSxJQUFJLFdBQVcsSUFBSSxtQkFBVSxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFFbkgsSUFBSSxDQUFDLDJCQUEyQixFQUFFO1lBQzlCLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDO2dCQUM1QixDQUFDLHNCQUFZLENBQUMsV0FBVyxDQUFDLEVBQUUsc0JBQWtCO2FBQ2pELENBQUMsQ0FBQztTQUNOO0lBQ0wsQ0FBQztJQUVELG9CQUFvQjtRQUNoQixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVMsQ0FBQyxzQkFBWSxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBRS9ELElBQUksS0FBSyxLQUFLLEtBQUssQ0FBQztZQUNoQixPQUFPO1FBRVgsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksS0FBSyxDQUFDLEtBQUssQ0FBQyxJQUFJLEtBQUssR0FBRyxJQUFJLElBQUksS0FBSyxHQUFHLENBQUM7WUFDdEUsTUFBTSxJQUFJLHNCQUFZLENBQUMsc0JBQWMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO0lBQ2pFLENBQUM7SUFFRCwwQkFBMEI7UUFDdEIsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxTQUFTLENBQUMsc0JBQVksQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUUzRSxJQUFJLFdBQVcsS0FBSyxLQUFLLENBQUM7WUFDdEIsT0FBTztRQUVYLElBQUksT0FBTyxXQUFXLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxXQUFXLENBQUMsSUFBSSxXQUFXLEdBQUcsQ0FBQztZQUN4RSxNQUFNLElBQUksc0JBQVksQ0FBQyxzQkFBYyxDQUFDLHdCQUF3QixDQUFDLENBQUM7SUFDeEUsQ0FBQztJQUVELDBCQUEwQjtRQUN0QixJQUFJLFdBQVcsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVMsQ0FBQyxzQkFBWSxDQUFDLFdBQVcsQ0FBQyxDQUFDO1FBRXpFLElBQUksV0FBVyxLQUFLLEtBQUssQ0FBQztZQUN0QixPQUFPO1FBRVgsNEJBQVUsQ0FBQyxDQUFFLG9CQUFFLENBQUMsTUFBTSxFQUFFLG9CQUFFLENBQUMsS0FBSyxDQUFFLEVBQUUsSUFBSSxFQUFFLHdCQUF3QixFQUFFLFdBQVcsQ0FBQyxDQUFDO1FBRWpGLElBQUksT0FBTyxXQUFXLEtBQUssUUFBUTtZQUMvQixXQUFXLEdBQUcsQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUVoQyxXQUFXLEdBQUcsV0FBVyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsRUFBRSxLQUFLLEVBQUUsRUFBRTtZQUM1Qyw0QkFBVSxDQUFDLG9CQUFFLENBQUMsTUFBTSxFQUFFLElBQUksRUFBRSx3QkFBd0IsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUU3RCxPQUFPLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBQ3hDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVQLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLEVBQUUsV0FBVyxFQUFFLENBQUMsQ0FBQztJQUNyRCxDQUFDO0lBRUQscUJBQXFCO1FBQ2pCLElBQUksRUFBRSxJQUFJLEVBQUUsV0FBVyxFQUFFLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxTQUFTLENBQUMsc0JBQVksQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLENBQUM7UUFFekYsSUFBSSxDQUFDLElBQUk7WUFDTCxJQUFJLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxTQUFTLENBQUMsc0JBQVksQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUVyRSxJQUFJLENBQUMsV0FBVztZQUNaLFdBQVcsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVMsQ0FBQyxzQkFBWSxDQUFDLHFCQUFxQixDQUFDLENBQUM7UUFFbkYsT0FBTyxFQUFFLElBQUksRUFBRSxXQUFXLEVBQUUsQ0FBQztJQUNqQyxDQUFDO0lBRUQsMEJBQTBCO1FBQ3RCLE1BQU0sRUFBRSxJQUFJLEVBQUUsV0FBVyxFQUFFLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUM7UUFFM0QsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVMsQ0FBQyxzQkFBWSxDQUFDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUM7UUFFbEcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDLHNCQUFZLENBQUMsa0JBQWtCLENBQUMsRUFBRSxrQkFBa0IsRUFBRSxDQUFDLENBQUM7UUFFM0YsSUFBSSxrQkFBa0I7WUFDbEIsT0FBTztRQUVYLElBQUksSUFBSSxFQUFFO1lBQ04sSUFBSSxDQUFDLHVCQUF1QixDQUFDLElBQUksRUFBRSxpQ0FBaUMsQ0FBQyxDQUFDO1lBRXRFLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQyxzQkFBWSxDQUFDLFdBQVcsQ0FBQyxFQUFFLEVBQUUsSUFBSSxFQUFFLGNBQVcsQ0FBQyxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQztTQUNoRztRQUVELElBQUksV0FBVyxFQUFFO1lBQ2IsSUFBSSxDQUFDLHVCQUF1QixDQUFDLFdBQVcsRUFBRSwwQkFBMEIsQ0FBQyxDQUFDO1lBRXRFLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQyxzQkFBWSxDQUFDLFdBQVcsQ0FBQyxFQUFFLEVBQUUsV0FBVyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1NBQ3BGO0lBQ0wsQ0FBQztJQUVELEtBQUssQ0FBQyxxQkFBcUI7UUFDdkIsTUFBTSxTQUFTLEdBQWMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxTQUFTLENBQUMsc0JBQVksQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUNsRixNQUFNLG9CQUFvQixHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsU0FBUyxDQUFDLHNCQUFZLENBQUMsb0JBQW9CLENBQUMsQ0FBQztRQUU3RixJQUFJLFlBQVksR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVMsQ0FBQyxzQkFBWSxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBRTNFLElBQUksQ0FBQyxTQUFTLEVBQUU7WUFDWixJQUFJLFlBQVksSUFBSSxvQkFBb0I7Z0JBQ3BDLE1BQU0sSUFBSSxzQkFBWSxDQUFDLHNCQUFjLENBQUMsa0RBQWtELENBQUMsQ0FBQztZQUU5RixPQUFPO1NBQ1Y7UUFFRCxJQUFJLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUMsc0JBQVksQ0FBQyxTQUFTLENBQUMsRUFBRSxjQUFXLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBRXRGLElBQUksQ0FBQyxZQUFZLEVBQUU7WUFDZixZQUFZLEdBQUcsRUFBRSxDQUFDO1lBRWxCLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQyxzQkFBWSxDQUFDLFlBQVksQ0FBQyxFQUFFLFlBQVksRUFBRSxDQUFDLENBQUM7U0FDbEY7UUFFRCxJQUFJLFlBQVksQ0FBQyxVQUFVO1lBQ3ZCLFlBQVksQ0FBQyxVQUFVLEdBQUcsY0FBVyxDQUFDLFlBQVksQ0FBQyxVQUFVLENBQUMsQ0FBQzs7WUFFL0QsWUFBWSxDQUFDLFVBQVUsR0FBRyxNQUFNLHVCQUFZLEVBQUUsQ0FBQztRQUVuRCxJQUFJLENBQUMsWUFBWSxDQUFDLFVBQVU7WUFDeEIsTUFBTSxJQUFJLHNCQUFZLENBQUMsc0JBQWMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO0lBQ2hFLENBQUM7SUFFRCxLQUFLLENBQUMsbUJBQW1CO1FBQ3JCLElBQUksQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1FBQzVCLElBQUksQ0FBQywwQkFBMEIsRUFBRSxDQUFDO1FBQ2xDLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUM7UUFDbkMsSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUM7UUFDNUIsSUFBSSxDQUFDLDBCQUEwQixFQUFFLENBQUM7UUFDbEMsSUFBSSxDQUFDLDBCQUEwQixFQUFFLENBQUM7SUFDdEMsQ0FBQztJQUVELDRCQUE0QjtRQUN4QixPQUFPLElBQUksQ0FBQyxZQUFZO2FBQ25CLDJCQUEyQixFQUFFO2FBQzdCLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxFQUFFO1lBQzFCLElBQUksQ0FBQyxJQUFJLENBQUMsb0JBQW9CLENBQUMsQ0FBQztZQUVoQyxPQUFPLHFCQUFxQixDQUFDO1FBQ2pDLENBQUMsQ0FBQyxDQUFDO0lBQ1gsQ0FBQztJQUVELHVCQUF1QixDQUFFLGNBQWMsRUFBRSxRQUFRO1FBQzdDLE1BQU0sa0JBQWtCLEdBQUcseUJBQWEsQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUV6RCxJQUFJLGtCQUFrQixDQUFDLE1BQU07WUFDekIsTUFBTSxJQUFJLHNCQUFZLENBQUMsc0JBQWMsQ0FBQyxrQ0FBa0MsRUFBRSxjQUFjLEVBQUUsUUFBUSxFQUFFLGdDQUF3QixDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQztJQUMxSixDQUFDO0lBRUQsdUJBQXVCO1FBQ25CLElBQUksQ0FBQyxhQUFhLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDN0IsSUFBSSxDQUFDLGFBQWEsQ0FBQyw0QkFBNEIsRUFBRSxDQUFDO1FBRWxELElBQUksQ0FBQyxZQUFZLENBQUMsT0FBTyxHQUFrQixJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVMsQ0FBQyxzQkFBWSxDQUFDLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyxZQUFZLENBQUMsT0FBTyxDQUFDO1FBQ3ZILElBQUksQ0FBQyxZQUFZLENBQUMsUUFBUSxHQUFpQixJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVMsQ0FBQyxzQkFBWSxDQUFDLFFBQVEsQ0FBQyxJQUFJLElBQUksQ0FBQyxZQUFZLENBQUMsUUFBUSxDQUFDO1FBQzdILElBQUksQ0FBQyxZQUFZLENBQUMsV0FBVyxHQUFjLElBQUksQ0FBQyxhQUFhLENBQUMsU0FBUyxDQUFDLHNCQUFZLENBQUMsV0FBVyxDQUFDLENBQUM7UUFDbEcsSUFBSSxDQUFDLFlBQVksQ0FBQyxVQUFVLEdBQWUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxTQUFTLENBQUMsc0JBQVksQ0FBQyxVQUFVLENBQUMsSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLFVBQVUsQ0FBQztRQUNqSSxJQUFJLENBQUMsWUFBWSxDQUFDLFlBQVksR0FBYSxJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVMsQ0FBQyxzQkFBWSxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBQ25HLElBQUksQ0FBQyxZQUFZLENBQUMsTUFBTSxHQUFtQixJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVMsQ0FBQyxzQkFBWSxDQUFDLE1BQU0sQ0FBQyxJQUFJLElBQUksQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDO1FBQ3pILElBQUksQ0FBQyxZQUFZLENBQUMsU0FBUyxHQUFnQixJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVMsQ0FBQyxzQkFBWSxDQUFDLFFBQVEsQ0FBQyxJQUFJLElBQUksQ0FBQyxZQUFZLENBQUMsU0FBUyxDQUFDO1FBQzlILElBQUksQ0FBQyxZQUFZLENBQUMsWUFBWSxHQUFhLElBQUksQ0FBQyxhQUFhLENBQUMsU0FBUyxDQUFDLHNCQUFZLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDbkcsSUFBSSxDQUFDLFlBQVksQ0FBQyxhQUFhLEdBQVksSUFBSSxDQUFDLGFBQWEsQ0FBQyxTQUFTLENBQUMsc0JBQVksQ0FBQyxhQUFhLENBQUMsSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLGFBQWEsQ0FBQztRQUN2SSxJQUFJLENBQUMsWUFBWSxDQUFDLHNCQUFzQixHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsU0FBUyxDQUFDLHNCQUFZLENBQUMsc0JBQXNCLENBQUMsQ0FBQztJQUNqSCxDQUFDO0lBRUQsTUFBTTtJQUNOLGdCQUFnQixDQUFFLElBQUk7UUFDbEIsTUFBTSxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUUsR0FBRyxJQUFJLENBQUM7UUFFckMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUM3QixJQUFJLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxFQUFFLFdBQVcsRUFBRSxDQUFDLENBQUM7UUFFakQsT0FBTyxJQUFJLENBQUM7SUFDaEIsQ0FBQztJQUVELEdBQUcsQ0FBRSxHQUFHLE9BQU87UUFDWCxJQUFJLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHO1lBQzNCLE1BQU0sSUFBSSxzQkFBWSxDQUFDLHNCQUFjLENBQUMsOEJBQThCLEVBQUUsc0JBQVksQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUU1RixPQUFPLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQy9DLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQyxzQkFBWSxDQUFDLEdBQUcsQ0FBQyxFQUFFLE9BQU8sRUFBRSxDQUFDLENBQUM7UUFFakUsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsR0FBRyxJQUFJLENBQUM7UUFFbkMsT0FBTyxJQUFJLENBQUM7SUFDaEIsQ0FBQztJQUVELFFBQVEsQ0FBRSxHQUFHLFFBQVE7UUFDakIsSUFBSSxJQUFJLENBQUMsa0JBQWtCLENBQUMsUUFBUTtZQUNoQyxNQUFNLElBQUksc0JBQVksQ0FBQyxzQkFBYyxDQUFDLDhCQUE4QixFQUFFLHNCQUFZLENBQUMsUUFBUSxDQUFDLENBQUM7UUFFakcsUUFBUSxHQUFHLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUNqRCxJQUFJLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxFQUFFLFFBQVEsRUFBRSxDQUFDLENBQUM7UUFFOUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUM7UUFFeEMsT0FBTyxJQUFJLENBQUM7SUFDaEIsQ0FBQztJQUVELFdBQVcsQ0FBRSxXQUFXO1FBQ3BCLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLEVBQUUsV0FBVyxFQUFFLENBQUMsQ0FBQztRQUVqRCxPQUFPLElBQUksQ0FBQztJQUNoQixDQUFDO0lBRUQsUUFBUSxDQUFFLElBQUksRUFBRSxNQUFNO1FBQ2xCLElBQUksSUFBSSxDQUFDLGtCQUFrQixDQUFDLFFBQVE7WUFDaEMsTUFBTSxJQUFJLHNCQUFZLENBQUMsc0JBQWMsQ0FBQyw4QkFBOEIsRUFBRSxzQkFBWSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBRWpHLElBQUksU0FBUyxHQUFHLDJCQUFnQixDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQztRQUUvQyxTQUFTLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBRW5ELElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQyxzQkFBWSxDQUFDLFFBQVEsQ0FBQyxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUM7UUFFeEUsSUFBSSxDQUFDLGtCQUFrQixDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUM7UUFFeEMsT0FBTyxJQUFJLENBQUM7SUFDaEIsQ0FBQztJQUVELE1BQU0sQ0FBRSxNQUFNO1FBQ1YsSUFBSSxDQUFDLGFBQWEsQ0FBQyxZQUFZLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxDQUFDO1FBRTVDLE9BQU8sSUFBSSxDQUFDO0lBQ2hCLENBQUM7SUFFRCxRQUFRLENBQUUsS0FBSyxFQUFFLFdBQVc7UUFDeEIsSUFBSSxDQUFDLGFBQWEsQ0FBQyxZQUFZLENBQUMsRUFBRSxLQUFLLEVBQUUsV0FBVyxFQUFFLENBQUMsQ0FBQztRQUV4RCxPQUFPLElBQUksQ0FBQztJQUNoQixDQUFDO0lBRUQsV0FBVyxDQUFFLEdBQUcsT0FBTztRQUNuQixJQUFJLFFBQVEsQ0FBQztRQUNiLElBQUksQ0FBQyxJQUFJLEVBQUUsV0FBVyxFQUFFLFdBQVcsQ0FBQyxHQUFHLE9BQU8sQ0FBQztRQUUvQyxJQUFJLE9BQU8sQ0FBQyxNQUFNLEtBQUssQ0FBQyxJQUFJLE9BQU8sQ0FBQyxDQUFDLENBQUMsSUFBSSxPQUFPLE9BQU8sQ0FBQyxDQUFDLENBQUMsS0FBSyxRQUFRO1lBQ3BFLENBQUMsRUFBRSxJQUFJLEVBQUUsV0FBVyxFQUFFLFdBQVcsRUFBRSxRQUFRLEVBQUUsR0FBRyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUVoRSxJQUFJLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxFQUFFLFdBQVcsRUFBRSxFQUFFLElBQUksRUFBRSxXQUFXLEVBQUUsV0FBVyxFQUFFLFFBQVEsRUFBRSxFQUFFLENBQUMsQ0FBQztRQUUvRixPQUFPLElBQUksQ0FBQztJQUNoQixDQUFDO0lBRUQsS0FBSyxDQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsZUFBZTtRQUNqQyxJQUFJLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQztZQUM1QixDQUFDLHNCQUFZLENBQUMsU0FBUyxDQUFDLEVBQWEsSUFBSTtZQUN6QyxDQUFDLHNCQUFZLENBQUMsWUFBWSxDQUFDLEVBQVUsT0FBTztZQUM1QyxDQUFDLHNCQUFZLENBQUMsb0JBQW9CLENBQUMsRUFBRSxlQUFlO1NBQ3ZELENBQUMsQ0FBQztRQUVILE9BQU8sSUFBSSxDQUFDO0lBQ2hCLENBQUM7SUFFRCxRQUFRLENBQUUsT0FBTyxFQUFFLFNBQVM7UUFDeEIsSUFBSSxDQUFDLGFBQWEsQ0FBQyxZQUFZLENBQUM7WUFDNUIsQ0FBQyxzQkFBWSxDQUFDLFVBQVUsQ0FBQyxFQUFJLE9BQU87WUFDcEMsQ0FBQyxzQkFBWSxDQUFDLFlBQVksQ0FBQyxFQUFFLFNBQVM7U0FDekMsQ0FBQyxDQUFDO1FBRUgsT0FBTyxJQUFJLENBQUM7SUFDaEIsQ0FBQztJQUVELFlBQVksQ0FBRSxJQUFJO1FBQ2QsSUFBSSxDQUFDLGFBQWEsQ0FBQyxZQUFZLENBQUM7WUFDNUIsQ0FBQyxzQkFBWSxDQUFDLFlBQVksQ0FBQyxFQUFFLElBQUk7U0FDcEMsQ0FBQyxDQUFDO1FBRUgsT0FBTyxJQUFJLENBQUM7SUFDaEIsQ0FBQztJQUVELGFBQWEsQ0FBRSxHQUFHLE9BQU87UUFDckIsSUFBSSxJQUFJLENBQUMsa0JBQWtCLENBQUMsYUFBYTtZQUNyQyxNQUFNLElBQUksc0JBQVksQ0FBQyxzQkFBYyxDQUFDLDhCQUE4QixFQUFFLHNCQUFZLENBQUMsYUFBYSxDQUFDLENBQUM7UUFFdEcsT0FBTyxHQUFHLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUUvQyxJQUFJLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUMsc0JBQVksQ0FBQyxhQUFhLENBQUMsRUFBRSxPQUFPLEVBQUUsQ0FBQyxDQUFDO1FBRTNFLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxhQUFhLEdBQUcsSUFBSSxDQUFDO1FBRTdDLE9BQU8sSUFBSSxDQUFDO0lBQ2hCLENBQUM7SUFFRCxLQUFLLENBQUMscUJBQXFCLENBQUUsS0FBSyxFQUFFLGFBQWE7UUFDN0MsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFDLElBQUksRUFBQyxFQUFFO1lBQ3RDLElBQUksSUFBSSxDQUFDLFFBQVE7Z0JBQ2IsT0FBTztZQUVYLElBQUksdUJBQXVCLEdBQUcsTUFBTSxjQUFpQixDQUFDLElBQUksQ0FBQyxhQUFhLEVBQUUsY0FBTyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztZQUUzRyx1QkFBdUIsR0FBRyxhQUFhLENBQUMsTUFBTSxDQUFDLHVCQUF1QixDQUFDLENBQUM7WUFFeEUsSUFBSSxDQUFDLGFBQWEsR0FBRyxxQkFBYSxDQUFDLHVCQUF1QixDQUFDLENBQUM7UUFDaEUsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNSLENBQUM7SUFFRCxHQUFHLENBQUUsT0FBTyxHQUFHLEVBQUU7UUFDYixJQUFJLENBQUMsa0JBQWtCLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDaEMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxZQUFZLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDekMsSUFBSSxDQUFDLHVCQUF1QixFQUFFLENBQUM7UUFFL0IsTUFBTSxjQUFjLEdBQUcsT0FBTyxDQUFDLE9BQU8sRUFBRTthQUNuQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLG1CQUFtQixFQUFFLENBQUM7YUFDdEMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLElBQUksQ0FBQyw0QkFBNEIsRUFBRSxDQUFDO2FBQy9DLElBQUksQ0FBQyxLQUFLLEVBQUUsRUFBRSxlQUFlLEVBQUUsVUFBVSxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsbUJBQW1CLEVBQUUsRUFBRSxFQUFFO1lBQ25GLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixDQUFDLEtBQUssRUFBRSxtQkFBbUIsQ0FBQyxDQUFDO1lBRTdELE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQyxlQUFlLEVBQUUsVUFBVSxFQUFFLEtBQUssRUFBRSxTQUFTLENBQUMsQ0FBQztRQUN4RSxDQUFDLENBQUMsQ0FBQztRQUVQLE9BQU8sSUFBSSxDQUFDLHdCQUF3QixDQUFDLGNBQWMsQ0FBQyxDQUFDO0lBQ3pELENBQUM7SUFFRCxLQUFLLENBQUMsSUFBSTtRQUNOLDBEQUEwRDtRQUMxRCxpRUFBaUU7UUFDakUsNEVBQTRFO1FBQzVFLDZEQUE2RDtRQUM3RCxNQUFNLG9CQUFvQixHQUFHLHFCQUFVLENBQUMsSUFBSSxDQUFDLG1CQUFtQixFQUFFLFdBQVcsQ0FBQyxFQUFFLENBQUMsV0FBVyxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUM7UUFFdkcsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLG9CQUFvQixDQUFDLENBQUM7SUFDNUMsQ0FBQztDQUNKO0FBMWVELHlCQTBlQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHJlc29sdmUgYXMgcmVzb2x2ZVBhdGgsIGRpcm5hbWUgfSBmcm9tICdwYXRoJztcbmltcG9ydCBkZWJ1ZyBmcm9tICdkZWJ1Zyc7XG5pbXBvcnQgcHJvbWlzaWZ5RXZlbnQgZnJvbSAncHJvbWlzaWZ5LWV2ZW50JztcbmltcG9ydCBtYXBSZXZlcnNlIGZyb20gJ21hcC1yZXZlcnNlJztcbmltcG9ydCB7IEV2ZW50RW1pdHRlciB9IGZyb20gJ2V2ZW50cyc7XG5pbXBvcnQge1xuICAgIGZsYXR0ZW5EZWVwIGFzIGZsYXR0ZW4sXG4gICAgcHVsbCBhcyByZW1vdmUsXG4gICAgaXNGdW5jdGlvblxufSBmcm9tICdsb2Rhc2gnO1xuXG5pbXBvcnQgQm9vdHN0cmFwcGVyIGZyb20gJy4vYm9vdHN0cmFwcGVyJztcbmltcG9ydCBSZXBvcnRlciBmcm9tICcuLi9yZXBvcnRlcic7XG5pbXBvcnQgVGFzayBmcm9tICcuL3Rhc2snO1xuaW1wb3J0IGRlZmF1bHREZWJ1Z0xvZ2dlciBmcm9tICcuLi9ub3RpZmljYXRpb25zL2RlYnVnLWxvZ2dlcic7XG5pbXBvcnQgeyBHZW5lcmFsRXJyb3IgfSBmcm9tICcuLi9lcnJvcnMvcnVudGltZSc7XG5pbXBvcnQgeyBSVU5USU1FX0VSUk9SUyB9IGZyb20gJy4uL2Vycm9ycy90eXBlcyc7XG5pbXBvcnQgeyBhc3NlcnRUeXBlLCBpcyB9IGZyb20gJy4uL2Vycm9ycy9ydW50aW1lL3R5cGUtYXNzZXJ0aW9ucyc7XG5pbXBvcnQgeyByZW5kZXJGb3JiaWRkZW5DaGFyc0xpc3QgfSBmcm9tICcuLi9lcnJvcnMvdGVzdC1ydW4vdXRpbHMnO1xuaW1wb3J0IGRldGVjdEZGTVBFRyBmcm9tICcuLi91dGlscy9kZXRlY3QtZmZtcGVnJztcbmltcG9ydCBjaGVja0ZpbGVQYXRoIGZyb20gJy4uL3V0aWxzL2NoZWNrLWZpbGUtcGF0aCc7XG5pbXBvcnQge1xuICAgIGFkZFJ1bm5pbmdUZXN0LFxuICAgIHJlbW92ZVJ1bm5pbmdUZXN0LFxuICAgIHN0YXJ0SGFuZGxpbmdUZXN0RXJyb3JzLFxuICAgIHN0b3BIYW5kbGluZ1Rlc3RFcnJvcnNcbn0gZnJvbSAnLi4vdXRpbHMvaGFuZGxlLWVycm9ycyc7XG5cbmltcG9ydCBPUFRJT05fTkFNRVMgZnJvbSAnLi4vY29uZmlndXJhdGlvbi9vcHRpb24tbmFtZXMnO1xuaW1wb3J0IEZsYWdMaXN0IGZyb20gJy4uL3V0aWxzL2ZsYWctbGlzdCc7XG5pbXBvcnQgcHJlcGFyZVJlcG9ydGVycyBmcm9tICcuLi91dGlscy9wcmVwYXJlLXJlcG9ydGVycyc7XG5pbXBvcnQgbG9hZENsaWVudFNjcmlwdHMgZnJvbSAnLi4vY3VzdG9tLWNsaWVudC1zY3JpcHRzL2xvYWQnO1xuaW1wb3J0IHsgc2V0VW5pcXVlVXJscyB9IGZyb20gJy4uL2N1c3RvbS1jbGllbnQtc2NyaXB0cy91dGlscyc7XG5pbXBvcnQgUmVwb3J0ZXJTdHJlYW1Db250cm9sbGVyIGZyb20gJy4vcmVwb3J0ZXItc3RyZWFtLWNvbnRyb2xsZXInO1xuXG5jb25zdCBERUJVR19MT0dHRVIgPSBkZWJ1ZygndGVzdGNhZmU6cnVubmVyJyk7XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFJ1bm5lciBleHRlbmRzIEV2ZW50RW1pdHRlciB7XG4gICAgY29uc3RydWN0b3IgKHByb3h5LCBicm93c2VyQ29ubmVjdGlvbkdhdGV3YXksIGNvbmZpZ3VyYXRpb24sIGNvbXBpbGVyU2VydmljZSkge1xuICAgICAgICBzdXBlcigpO1xuXG4gICAgICAgIHRoaXMucHJveHkgICAgICAgICAgICAgICA9IHByb3h5O1xuICAgICAgICB0aGlzLmJvb3RzdHJhcHBlciAgICAgICAgPSB0aGlzLl9jcmVhdGVCb290c3RyYXBwZXIoYnJvd3NlckNvbm5lY3Rpb25HYXRld2F5LCBjb21waWxlclNlcnZpY2UpO1xuICAgICAgICB0aGlzLnBlbmRpbmdUYXNrUHJvbWlzZXMgPSBbXTtcbiAgICAgICAgdGhpcy5jb25maWd1cmF0aW9uICAgICAgID0gY29uZmlndXJhdGlvbjtcbiAgICAgICAgdGhpcy5pc0NsaSAgICAgICAgICAgICAgID0gZmFsc2U7XG5cbiAgICAgICAgdGhpcy5hcGlNZXRob2RXYXNDYWxsZWQgPSBuZXcgRmxhZ0xpc3QoW1xuICAgICAgICAgICAgT1BUSU9OX05BTUVTLnNyYyxcbiAgICAgICAgICAgIE9QVElPTl9OQU1FUy5icm93c2VycyxcbiAgICAgICAgICAgIE9QVElPTl9OQU1FUy5yZXBvcnRlcixcbiAgICAgICAgICAgIE9QVElPTl9OQU1FUy5jbGllbnRTY3JpcHRzXG4gICAgICAgIF0pO1xuICAgIH1cblxuICAgIF9jcmVhdGVCb290c3RyYXBwZXIgKGJyb3dzZXJDb25uZWN0aW9uR2F0ZXdheSwgY29tcGlsZXJTZXJ2aWNlKSB7XG4gICAgICAgIHJldHVybiBuZXcgQm9vdHN0cmFwcGVyKGJyb3dzZXJDb25uZWN0aW9uR2F0ZXdheSwgY29tcGlsZXJTZXJ2aWNlKTtcbiAgICB9XG5cbiAgICBfZGlzcG9zZUJyb3dzZXJTZXQgKGJyb3dzZXJTZXQpIHtcbiAgICAgICAgcmV0dXJuIGJyb3dzZXJTZXQuZGlzcG9zZSgpLmNhdGNoKGUgPT4gREVCVUdfTE9HR0VSKGUpKTtcbiAgICB9XG5cbiAgICBfZGlzcG9zZVJlcG9ydGVycyAocmVwb3J0ZXJzKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLmFsbChyZXBvcnRlcnMubWFwKHJlcG9ydGVyID0+IHJlcG9ydGVyLmRpc3Bvc2UoKS5jYXRjaChlID0+IERFQlVHX0xPR0dFUihlKSkpKTtcbiAgICB9XG5cbiAgICBfZGlzcG9zZVRlc3RlZEFwcCAodGVzdGVkQXBwKSB7XG4gICAgICAgIHJldHVybiB0ZXN0ZWRBcHAgPyB0ZXN0ZWRBcHAua2lsbCgpLmNhdGNoKGUgPT4gREVCVUdfTE9HR0VSKGUpKSA6IFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cblxuICAgIGFzeW5jIF9kaXNwb3NlVGFza0FuZFJlbGF0ZWRBc3NldHMgKHRhc2ssIGJyb3dzZXJTZXQsIHJlcG9ydGVycywgdGVzdGVkQXBwKSB7XG4gICAgICAgIHRhc2suYWJvcnQoKTtcbiAgICAgICAgdGFzay51blJlZ2lzdGVyQ2xpZW50U2NyaXB0Um91dGluZygpO1xuICAgICAgICB0YXNrLmNsZWFyTGlzdGVuZXJzKCk7XG5cbiAgICAgICAgYXdhaXQgdGhpcy5fZGlzcG9zZUFzc2V0cyhicm93c2VyU2V0LCByZXBvcnRlcnMsIHRlc3RlZEFwcCk7XG4gICAgfVxuXG4gICAgX2Rpc3Bvc2VBc3NldHMgKGJyb3dzZXJTZXQsIHJlcG9ydGVycywgdGVzdGVkQXBwKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLmFsbChbXG4gICAgICAgICAgICB0aGlzLl9kaXNwb3NlQnJvd3NlclNldChicm93c2VyU2V0KSxcbiAgICAgICAgICAgIHRoaXMuX2Rpc3Bvc2VSZXBvcnRlcnMocmVwb3J0ZXJzKSxcbiAgICAgICAgICAgIHRoaXMuX2Rpc3Bvc2VUZXN0ZWRBcHAodGVzdGVkQXBwKVxuICAgICAgICBdKTtcbiAgICB9XG5cbiAgICBfcHJlcGFyZUFycmF5UGFyYW1ldGVyIChhcnJheSkge1xuICAgICAgICBhcnJheSA9IGZsYXR0ZW4oYXJyYXkpO1xuXG4gICAgICAgIGlmICh0aGlzLmlzQ2xpKVxuICAgICAgICAgICAgcmV0dXJuIGFycmF5Lmxlbmd0aCA9PT0gMCA/IHZvaWQgMCA6IGFycmF5O1xuXG4gICAgICAgIHJldHVybiBhcnJheTtcbiAgICB9XG5cbiAgICBfY3JlYXRlQ2FuY2VsYWJsZVByb21pc2UgKHRhc2tQcm9taXNlKSB7XG4gICAgICAgIGNvbnN0IHByb21pc2UgICAgICAgICAgID0gdGFza1Byb21pc2UudGhlbigoeyBjb21wbGV0aW9uUHJvbWlzZSB9KSA9PiBjb21wbGV0aW9uUHJvbWlzZSk7XG4gICAgICAgIGNvbnN0IHJlbW92ZUZyb21QZW5kaW5nID0gKCkgPT4gcmVtb3ZlKHRoaXMucGVuZGluZ1Rhc2tQcm9taXNlcywgcHJvbWlzZSk7XG5cbiAgICAgICAgcHJvbWlzZVxuICAgICAgICAgICAgLnRoZW4ocmVtb3ZlRnJvbVBlbmRpbmcpXG4gICAgICAgICAgICAuY2F0Y2gocmVtb3ZlRnJvbVBlbmRpbmcpO1xuXG4gICAgICAgIHByb21pc2UuY2FuY2VsID0gKCkgPT4gdGFza1Byb21pc2VcbiAgICAgICAgICAgIC50aGVuKCh7IGNhbmNlbFRhc2sgfSkgPT4gY2FuY2VsVGFzaygpKVxuICAgICAgICAgICAgLnRoZW4ocmVtb3ZlRnJvbVBlbmRpbmcpO1xuXG4gICAgICAgIHRoaXMucGVuZGluZ1Rhc2tQcm9taXNlcy5wdXNoKHByb21pc2UpO1xuXG4gICAgICAgIHJldHVybiBwcm9taXNlO1xuICAgIH1cblxuICAgIC8vIFJ1biB0YXNrXG4gICAgX2dldEZhaWxlZFRlc3RDb3VudCAodGFzaywgcmVwb3J0ZXIpIHtcbiAgICAgICAgbGV0IGZhaWxlZFRlc3RDb3VudCA9IHJlcG9ydGVyLnRlc3RDb3VudCAtIHJlcG9ydGVyLnBhc3NlZDtcblxuICAgICAgICBpZiAodGFzay5vcHRzLnN0b3BPbkZpcnN0RmFpbCAmJiAhIWZhaWxlZFRlc3RDb3VudClcbiAgICAgICAgICAgIGZhaWxlZFRlc3RDb3VudCA9IDE7XG5cbiAgICAgICAgcmV0dXJuIGZhaWxlZFRlc3RDb3VudDtcbiAgICB9XG5cbiAgICBhc3luYyBfZ2V0VGFza1Jlc3VsdCAodGFzaywgYnJvd3NlclNldCwgcmVwb3J0ZXJzLCB0ZXN0ZWRBcHApIHtcbiAgICAgICAgaWYgKCF0YXNrLm9wdHMubGl2ZSkge1xuICAgICAgICAgICAgdGFzay5vbignYnJvd3Nlci1qb2ItZG9uZScsIGpvYiA9PiB7XG4gICAgICAgICAgICAgICAgam9iLmJyb3dzZXJDb25uZWN0aW9ucy5mb3JFYWNoKGJjID0+IGJyb3dzZXJTZXQucmVsZWFzZUNvbm5lY3Rpb24oYmMpKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYnJvd3NlclNldEVycm9yUHJvbWlzZSA9IHByb21pc2lmeUV2ZW50KGJyb3dzZXJTZXQsICdlcnJvcicpO1xuICAgICAgICBjb25zdCB0YXNrRXJyb3JQcm9taXNlICAgICAgID0gcHJvbWlzaWZ5RXZlbnQodGFzaywgJ2Vycm9yJyk7XG4gICAgICAgIGNvbnN0IHN0cmVhbUNvbnRyb2xsZXIgICAgICAgPSBuZXcgUmVwb3J0ZXJTdHJlYW1Db250cm9sbGVyKHRhc2ssIHJlcG9ydGVycyk7XG5cbiAgICAgICAgY29uc3QgdGFza0RvbmVQcm9taXNlID0gdGFzay5vbmNlKCdkb25lJylcbiAgICAgICAgICAgIC50aGVuKCgpID0+IGJyb3dzZXJTZXRFcnJvclByb21pc2UuY2FuY2VsKCkpXG4gICAgICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKHJlcG9ydGVycy5tYXAocmVwb3J0ZXIgPT4gcmVwb3J0ZXIucGVuZGluZ1Rhc2tEb25lUHJvbWlzZSkpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgcHJvbWlzZXMgPSBbXG4gICAgICAgICAgICB0YXNrRG9uZVByb21pc2UsXG4gICAgICAgICAgICBicm93c2VyU2V0RXJyb3JQcm9taXNlLFxuICAgICAgICAgICAgdGFza0Vycm9yUHJvbWlzZVxuICAgICAgICBdO1xuXG4gICAgICAgIGlmICh0ZXN0ZWRBcHApXG4gICAgICAgICAgICBwcm9taXNlcy5wdXNoKHRlc3RlZEFwcC5lcnJvclByb21pc2UpO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCBQcm9taXNlLnJhY2UocHJvbWlzZXMpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuX2Rpc3Bvc2VUYXNrQW5kUmVsYXRlZEFzc2V0cyh0YXNrLCBicm93c2VyU2V0LCByZXBvcnRlcnMsIHRlc3RlZEFwcCk7XG5cbiAgICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHRoaXMuX2Rpc3Bvc2VBc3NldHMoYnJvd3NlclNldCwgcmVwb3J0ZXJzLCB0ZXN0ZWRBcHApO1xuXG4gICAgICAgIGlmIChzdHJlYW1Db250cm9sbGVyLm11bHRpcGxlU3RyZWFtRXJyb3IpXG4gICAgICAgICAgICB0aHJvdyBzdHJlYW1Db250cm9sbGVyLm11bHRpcGxlU3RyZWFtRXJyb3I7XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuX2dldEZhaWxlZFRlc3RDb3VudCh0YXNrLCByZXBvcnRlcnNbMF0pO1xuICAgIH1cblxuICAgIF9jcmVhdGVUYXNrICh0ZXN0cywgYnJvd3NlckNvbm5lY3Rpb25Hcm91cHMsIHByb3h5LCBvcHRzKSB7XG4gICAgICAgIHJldHVybiBuZXcgVGFzayh0ZXN0cywgYnJvd3NlckNvbm5lY3Rpb25Hcm91cHMsIHByb3h5LCBvcHRzKTtcbiAgICB9XG5cbiAgICBfcnVuVGFzayAocmVwb3J0ZXJQbHVnaW5zLCBicm93c2VyU2V0LCB0ZXN0cywgdGVzdGVkQXBwKSB7XG4gICAgICAgIGNvbnN0IHRhc2sgICAgICAgICAgICAgID0gdGhpcy5fY3JlYXRlVGFzayh0ZXN0cywgYnJvd3NlclNldC5icm93c2VyQ29ubmVjdGlvbkdyb3VwcywgdGhpcy5wcm94eSwgdGhpcy5jb25maWd1cmF0aW9uLmdldE9wdGlvbnMoKSk7XG4gICAgICAgIGNvbnN0IHJlcG9ydGVycyAgICAgICAgID0gcmVwb3J0ZXJQbHVnaW5zLm1hcChyZXBvcnRlciA9PiBuZXcgUmVwb3J0ZXIocmVwb3J0ZXIucGx1Z2luLCB0YXNrLCByZXBvcnRlci5vdXRTdHJlYW0sIHJlcG9ydGVyLm5hbWUpKTtcbiAgICAgICAgY29uc3QgY29tcGxldGlvblByb21pc2UgPSB0aGlzLl9nZXRUYXNrUmVzdWx0KHRhc2ssIGJyb3dzZXJTZXQsIHJlcG9ydGVycywgdGVzdGVkQXBwKTtcbiAgICAgICAgbGV0IGNvbXBsZXRlZCAgICAgICAgICAgPSBmYWxzZTtcblxuICAgICAgICB0YXNrLm9uKCdzdGFydCcsIHN0YXJ0SGFuZGxpbmdUZXN0RXJyb3JzKTtcblxuICAgICAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbi5nZXRPcHRpb24oT1BUSU9OX05BTUVTLnNraXBVbmNhdWdodEVycm9ycykpIHtcbiAgICAgICAgICAgIHRhc2sub24oJ3Rlc3QtcnVuLXN0YXJ0JywgYWRkUnVubmluZ1Rlc3QpO1xuICAgICAgICAgICAgdGFzay5vbigndGVzdC1ydW4tZG9uZScsIHJlbW92ZVJ1bm5pbmdUZXN0KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRhc2sub24oJ2RvbmUnLCBzdG9wSGFuZGxpbmdUZXN0RXJyb3JzKTtcblxuICAgICAgICB0YXNrLm9uKCdlcnJvcicsIHN0b3BIYW5kbGluZ1Rlc3RFcnJvcnMpO1xuXG4gICAgICAgIGNvbnN0IG9uVGFza0NvbXBsZXRlZCA9ICgpID0+IHtcbiAgICAgICAgICAgIHRhc2sudW5SZWdpc3RlckNsaWVudFNjcmlwdFJvdXRpbmcoKTtcblxuICAgICAgICAgICAgY29tcGxldGVkID0gdHJ1ZTtcbiAgICAgICAgfTtcblxuICAgICAgICBjb21wbGV0aW9uUHJvbWlzZVxuICAgICAgICAgICAgLnRoZW4ob25UYXNrQ29tcGxldGVkKVxuICAgICAgICAgICAgLmNhdGNoKG9uVGFza0NvbXBsZXRlZCk7XG5cbiAgICAgICAgY29uc3QgY2FuY2VsVGFzayA9IGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGlmICghY29tcGxldGVkKVxuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuX2Rpc3Bvc2VUYXNrQW5kUmVsYXRlZEFzc2V0cyh0YXNrLCBicm93c2VyU2V0LCByZXBvcnRlcnMsIHRlc3RlZEFwcCk7XG4gICAgICAgIH07XG5cbiAgICAgICAgcmV0dXJuIHsgY29tcGxldGlvblByb21pc2UsIGNhbmNlbFRhc2sgfTtcbiAgICB9XG5cbiAgICBfcmVnaXN0ZXJBc3NldHMgKGFzc2V0cykge1xuICAgICAgICBhc3NldHMuZm9yRWFjaChhc3NldCA9PiB0aGlzLnByb3h5LkdFVChhc3NldC5wYXRoLCBhc3NldC5pbmZvKSk7XG4gICAgfVxuXG4gICAgX3ZhbGlkYXRlRGVidWdMb2dnZXIgKCkge1xuICAgICAgICBjb25zdCBkZWJ1Z0xvZ2dlciA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRPcHRpb24oT1BUSU9OX05BTUVTLmRlYnVnTG9nZ2VyKTtcblxuICAgICAgICBjb25zdCBkZWJ1Z0xvZ2dlckRlZmluZWRDb3JyZWN0bHkgPSBkZWJ1Z0xvZ2dlciA9PT0gbnVsbCB8fCAhIWRlYnVnTG9nZ2VyICYmXG4gICAgICAgICAgICBbJ3Nob3dCcmVha3BvaW50JywgJ2hpZGVCcmVha3BvaW50J10uZXZlcnkobWV0aG9kID0+IG1ldGhvZCBpbiBkZWJ1Z0xvZ2dlciAmJiBpc0Z1bmN0aW9uKGRlYnVnTG9nZ2VyW21ldGhvZF0pKTtcblxuICAgICAgICBpZiAoIWRlYnVnTG9nZ2VyRGVmaW5lZENvcnJlY3RseSkge1xuICAgICAgICAgICAgdGhpcy5jb25maWd1cmF0aW9uLm1lcmdlT3B0aW9ucyh7XG4gICAgICAgICAgICAgICAgW09QVElPTl9OQU1FUy5kZWJ1Z0xvZ2dlcl06IGRlZmF1bHREZWJ1Z0xvZ2dlclxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBfdmFsaWRhdGVTcGVlZE9wdGlvbiAoKSB7XG4gICAgICAgIGNvbnN0IHNwZWVkID0gdGhpcy5jb25maWd1cmF0aW9uLmdldE9wdGlvbihPUFRJT05fTkFNRVMuc3BlZWQpO1xuXG4gICAgICAgIGlmIChzcGVlZCA9PT0gdm9pZCAwKVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgIGlmICh0eXBlb2Ygc3BlZWQgIT09ICdudW1iZXInIHx8IGlzTmFOKHNwZWVkKSB8fCBzcGVlZCA8IDAuMDEgfHwgc3BlZWQgPiAxKVxuICAgICAgICAgICAgdGhyb3cgbmV3IEdlbmVyYWxFcnJvcihSVU5USU1FX0VSUk9SUy5pbnZhbGlkU3BlZWRWYWx1ZSk7XG4gICAgfVxuXG4gICAgX3ZhbGlkYXRlQ29uY3VycmVuY3lPcHRpb24gKCkge1xuICAgICAgICBjb25zdCBjb25jdXJyZW5jeSA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRPcHRpb24oT1BUSU9OX05BTUVTLmNvbmN1cnJlbmN5KTtcblxuICAgICAgICBpZiAoY29uY3VycmVuY3kgPT09IHZvaWQgMClcbiAgICAgICAgICAgIHJldHVybjtcblxuICAgICAgICBpZiAodHlwZW9mIGNvbmN1cnJlbmN5ICE9PSAnbnVtYmVyJyB8fCBpc05hTihjb25jdXJyZW5jeSkgfHwgY29uY3VycmVuY3kgPCAxKVxuICAgICAgICAgICAgdGhyb3cgbmV3IEdlbmVyYWxFcnJvcihSVU5USU1FX0VSUk9SUy5pbnZhbGlkQ29uY3VycmVuY3lGYWN0b3IpO1xuICAgIH1cblxuICAgIF92YWxpZGF0ZVByb3h5QnlwYXNzT3B0aW9uICgpIHtcbiAgICAgICAgbGV0IHByb3h5QnlwYXNzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldE9wdGlvbihPUFRJT05fTkFNRVMucHJveHlCeXBhc3MpO1xuXG4gICAgICAgIGlmIChwcm94eUJ5cGFzcyA9PT0gdm9pZCAwKVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgIGFzc2VydFR5cGUoWyBpcy5zdHJpbmcsIGlzLmFycmF5IF0sIG51bGwsICdcInByb3h5QnlwYXNzXCIgYXJndW1lbnQnLCBwcm94eUJ5cGFzcyk7XG5cbiAgICAgICAgaWYgKHR5cGVvZiBwcm94eUJ5cGFzcyA9PT0gJ3N0cmluZycpXG4gICAgICAgICAgICBwcm94eUJ5cGFzcyA9IFtwcm94eUJ5cGFzc107XG5cbiAgICAgICAgcHJveHlCeXBhc3MgPSBwcm94eUJ5cGFzcy5yZWR1Y2UoKGFyciwgcnVsZXMpID0+IHtcbiAgICAgICAgICAgIGFzc2VydFR5cGUoaXMuc3RyaW5nLCBudWxsLCAnXCJwcm94eUJ5cGFzc1wiIGFyZ3VtZW50JywgcnVsZXMpO1xuXG4gICAgICAgICAgICByZXR1cm4gYXJyLmNvbmNhdChydWxlcy5zcGxpdCgnLCcpKTtcbiAgICAgICAgfSwgW10pO1xuXG4gICAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5tZXJnZU9wdGlvbnMoeyBwcm94eUJ5cGFzcyB9KTtcbiAgICB9XG5cbiAgICBfZ2V0U2NyZWVuc2hvdE9wdGlvbnMgKCkge1xuICAgICAgICBsZXQgeyBwYXRoLCBwYXRoUGF0dGVybiB9ID0gdGhpcy5jb25maWd1cmF0aW9uLmdldE9wdGlvbihPUFRJT05fTkFNRVMuc2NyZWVuc2hvdHMpIHx8IHt9O1xuXG4gICAgICAgIGlmICghcGF0aClcbiAgICAgICAgICAgIHBhdGggPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0T3B0aW9uKE9QVElPTl9OQU1FUy5zY3JlZW5zaG90UGF0aCk7XG5cbiAgICAgICAgaWYgKCFwYXRoUGF0dGVybilcbiAgICAgICAgICAgIHBhdGhQYXR0ZXJuID0gdGhpcy5jb25maWd1cmF0aW9uLmdldE9wdGlvbihPUFRJT05fTkFNRVMuc2NyZWVuc2hvdFBhdGhQYXR0ZXJuKTtcblxuICAgICAgICByZXR1cm4geyBwYXRoLCBwYXRoUGF0dGVybiB9O1xuICAgIH1cblxuICAgIF92YWxpZGF0ZVNjcmVlbnNob3RPcHRpb25zICgpIHtcbiAgICAgICAgY29uc3QgeyBwYXRoLCBwYXRoUGF0dGVybiB9ID0gdGhpcy5fZ2V0U2NyZWVuc2hvdE9wdGlvbnMoKTtcblxuICAgICAgICBjb25zdCBkaXNhYmxlU2NyZWVuc2hvdHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0T3B0aW9uKE9QVElPTl9OQU1FUy5kaXNhYmxlU2NyZWVuc2hvdHMpIHx8ICFwYXRoO1xuXG4gICAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5tZXJnZU9wdGlvbnMoeyBbT1BUSU9OX05BTUVTLmRpc2FibGVTY3JlZW5zaG90c106IGRpc2FibGVTY3JlZW5zaG90cyB9KTtcblxuICAgICAgICBpZiAoZGlzYWJsZVNjcmVlbnNob3RzKVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgIGlmIChwYXRoKSB7XG4gICAgICAgICAgICB0aGlzLl92YWxpZGF0ZVNjcmVlbnNob3RQYXRoKHBhdGgsICdzY3JlZW5zaG90cyBiYXNlIGRpcmVjdG9yeSBwYXRoJyk7XG5cbiAgICAgICAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5tZXJnZU9wdGlvbnMoeyBbT1BUSU9OX05BTUVTLnNjcmVlbnNob3RzXTogeyBwYXRoOiByZXNvbHZlUGF0aChwYXRoKSB9IH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHBhdGhQYXR0ZXJuKSB7XG4gICAgICAgICAgICB0aGlzLl92YWxpZGF0ZVNjcmVlbnNob3RQYXRoKHBhdGhQYXR0ZXJuLCAnc2NyZWVuc2hvdHMgcGF0aCBwYXR0ZXJuJyk7XG5cbiAgICAgICAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5tZXJnZU9wdGlvbnMoeyBbT1BUSU9OX05BTUVTLnNjcmVlbnNob3RzXTogeyBwYXRoUGF0dGVybiB9IH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgYXN5bmMgX3ZhbGlkYXRlVmlkZW9PcHRpb25zICgpIHtcbiAgICAgICAgY29uc3QgdmlkZW9QYXRoICAgICAgICAgICAgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0T3B0aW9uKE9QVElPTl9OQU1FUy52aWRlb1BhdGgpO1xuICAgICAgICBjb25zdCB2aWRlb0VuY29kaW5nT3B0aW9ucyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRPcHRpb24oT1BUSU9OX05BTUVTLnZpZGVvRW5jb2RpbmdPcHRpb25zKTtcblxuICAgICAgICBsZXQgdmlkZW9PcHRpb25zID0gdGhpcy5jb25maWd1cmF0aW9uLmdldE9wdGlvbihPUFRJT05fTkFNRVMudmlkZW9PcHRpb25zKTtcblxuICAgICAgICBpZiAoIXZpZGVvUGF0aCkge1xuICAgICAgICAgICAgaWYgKHZpZGVvT3B0aW9ucyB8fCB2aWRlb0VuY29kaW5nT3B0aW9ucylcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgR2VuZXJhbEVycm9yKFJVTlRJTUVfRVJST1JTLmNhbm5vdFNldFZpZGVvT3B0aW9uc1dpdGhvdXRCYXNlVmlkZW9QYXRoU3BlY2lmaWVkKTtcblxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5jb25maWd1cmF0aW9uLm1lcmdlT3B0aW9ucyh7IFtPUFRJT05fTkFNRVMudmlkZW9QYXRoXTogcmVzb2x2ZVBhdGgodmlkZW9QYXRoKSB9KTtcblxuICAgICAgICBpZiAoIXZpZGVvT3B0aW9ucykge1xuICAgICAgICAgICAgdmlkZW9PcHRpb25zID0ge307XG5cbiAgICAgICAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5tZXJnZU9wdGlvbnMoeyBbT1BUSU9OX05BTUVTLnZpZGVvT3B0aW9uc106IHZpZGVvT3B0aW9ucyB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh2aWRlb09wdGlvbnMuZmZtcGVnUGF0aClcbiAgICAgICAgICAgIHZpZGVvT3B0aW9ucy5mZm1wZWdQYXRoID0gcmVzb2x2ZVBhdGgodmlkZW9PcHRpb25zLmZmbXBlZ1BhdGgpO1xuICAgICAgICBlbHNlXG4gICAgICAgICAgICB2aWRlb09wdGlvbnMuZmZtcGVnUGF0aCA9IGF3YWl0IGRldGVjdEZGTVBFRygpO1xuXG4gICAgICAgIGlmICghdmlkZW9PcHRpb25zLmZmbXBlZ1BhdGgpXG4gICAgICAgICAgICB0aHJvdyBuZXcgR2VuZXJhbEVycm9yKFJVTlRJTUVfRVJST1JTLmNhbm5vdEZpbmRGRk1QRUcpO1xuICAgIH1cblxuICAgIGFzeW5jIF92YWxpZGF0ZVJ1bk9wdGlvbnMgKCkge1xuICAgICAgICB0aGlzLl92YWxpZGF0ZURlYnVnTG9nZ2VyKCk7XG4gICAgICAgIHRoaXMuX3ZhbGlkYXRlU2NyZWVuc2hvdE9wdGlvbnMoKTtcbiAgICAgICAgYXdhaXQgdGhpcy5fdmFsaWRhdGVWaWRlb09wdGlvbnMoKTtcbiAgICAgICAgdGhpcy5fdmFsaWRhdGVTcGVlZE9wdGlvbigpO1xuICAgICAgICB0aGlzLl92YWxpZGF0ZUNvbmN1cnJlbmN5T3B0aW9uKCk7XG4gICAgICAgIHRoaXMuX3ZhbGlkYXRlUHJveHlCeXBhc3NPcHRpb24oKTtcbiAgICB9XG5cbiAgICBfY3JlYXRlUnVubmFibGVDb25maWd1cmF0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuYm9vdHN0cmFwcGVyXG4gICAgICAgICAgICAuY3JlYXRlUnVubmFibGVDb25maWd1cmF0aW9uKClcbiAgICAgICAgICAgIC50aGVuKHJ1bm5hYmxlQ29uZmlndXJhdGlvbiA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5lbWl0KCdkb25lLWJvb3RzdHJhcHBpbmcnKTtcblxuICAgICAgICAgICAgICAgIHJldHVybiBydW5uYWJsZUNvbmZpZ3VyYXRpb247XG4gICAgICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBfdmFsaWRhdGVTY3JlZW5zaG90UGF0aCAoc2NyZWVuc2hvdFBhdGgsIHBhdGhUeXBlKSB7XG4gICAgICAgIGNvbnN0IGZvcmJpZGRlbkNoYXJzTGlzdCA9IGNoZWNrRmlsZVBhdGgoc2NyZWVuc2hvdFBhdGgpO1xuXG4gICAgICAgIGlmIChmb3JiaWRkZW5DaGFyc0xpc3QubGVuZ3RoKVxuICAgICAgICAgICAgdGhyb3cgbmV3IEdlbmVyYWxFcnJvcihSVU5USU1FX0VSUk9SUy5mb3JiaWRkZW5DaGFyYXRlcnNJblNjcmVlbnNob3RQYXRoLCBzY3JlZW5zaG90UGF0aCwgcGF0aFR5cGUsIHJlbmRlckZvcmJpZGRlbkNoYXJzTGlzdChmb3JiaWRkZW5DaGFyc0xpc3QpKTtcbiAgICB9XG5cbiAgICBfc2V0Qm9vdHN0cmFwcGVyT3B0aW9ucyAoKSB7XG4gICAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5wcmVwYXJlKCk7XG4gICAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5ub3RpZnlBYm91dE92ZXJyaWRkZW5PcHRpb25zKCk7XG5cbiAgICAgICAgdGhpcy5ib290c3RyYXBwZXIuc291cmNlcyAgICAgICAgICAgICAgICA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRPcHRpb24oT1BUSU9OX05BTUVTLnNyYykgfHwgdGhpcy5ib290c3RyYXBwZXIuc291cmNlcztcbiAgICAgICAgdGhpcy5ib290c3RyYXBwZXIuYnJvd3NlcnMgICAgICAgICAgICAgICA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRPcHRpb24oT1BUSU9OX05BTUVTLmJyb3dzZXJzKSB8fCB0aGlzLmJvb3RzdHJhcHBlci5icm93c2VycztcbiAgICAgICAgdGhpcy5ib290c3RyYXBwZXIuY29uY3VycmVuY3kgICAgICAgICAgICA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRPcHRpb24oT1BUSU9OX05BTUVTLmNvbmN1cnJlbmN5KTtcbiAgICAgICAgdGhpcy5ib290c3RyYXBwZXIuYXBwQ29tbWFuZCAgICAgICAgICAgICA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRPcHRpb24oT1BUSU9OX05BTUVTLmFwcENvbW1hbmQpIHx8IHRoaXMuYm9vdHN0cmFwcGVyLmFwcENvbW1hbmQ7XG4gICAgICAgIHRoaXMuYm9vdHN0cmFwcGVyLmFwcEluaXREZWxheSAgICAgICAgICAgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0T3B0aW9uKE9QVElPTl9OQU1FUy5hcHBJbml0RGVsYXkpO1xuICAgICAgICB0aGlzLmJvb3RzdHJhcHBlci5maWx0ZXIgICAgICAgICAgICAgICAgID0gdGhpcy5jb25maWd1cmF0aW9uLmdldE9wdGlvbihPUFRJT05fTkFNRVMuZmlsdGVyKSB8fCB0aGlzLmJvb3RzdHJhcHBlci5maWx0ZXI7XG4gICAgICAgIHRoaXMuYm9vdHN0cmFwcGVyLnJlcG9ydGVycyAgICAgICAgICAgICAgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0T3B0aW9uKE9QVElPTl9OQU1FUy5yZXBvcnRlcikgfHwgdGhpcy5ib290c3RyYXBwZXIucmVwb3J0ZXJzO1xuICAgICAgICB0aGlzLmJvb3RzdHJhcHBlci50c0NvbmZpZ1BhdGggICAgICAgICAgID0gdGhpcy5jb25maWd1cmF0aW9uLmdldE9wdGlvbihPUFRJT05fTkFNRVMudHNDb25maWdQYXRoKTtcbiAgICAgICAgdGhpcy5ib290c3RyYXBwZXIuY2xpZW50U2NyaXB0cyAgICAgICAgICA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRPcHRpb24oT1BUSU9OX05BTUVTLmNsaWVudFNjcmlwdHMpIHx8IHRoaXMuYm9vdHN0cmFwcGVyLmNsaWVudFNjcmlwdHM7XG4gICAgICAgIHRoaXMuYm9vdHN0cmFwcGVyLmRpc2FibGVNdWx0aXBsZVdpbmRvd3MgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0T3B0aW9uKE9QVElPTl9OQU1FUy5kaXNhYmxlTXVsdGlwbGVXaW5kb3dzKTtcbiAgICB9XG5cbiAgICAvLyBBUElcbiAgICBlbWJlZGRpbmdPcHRpb25zIChvcHRzKSB7XG4gICAgICAgIGNvbnN0IHsgYXNzZXRzLCBUZXN0UnVuQ3RvciB9ID0gb3B0cztcblxuICAgICAgICB0aGlzLl9yZWdpc3RlckFzc2V0cyhhc3NldHMpO1xuICAgICAgICB0aGlzLmNvbmZpZ3VyYXRpb24ubWVyZ2VPcHRpb25zKHsgVGVzdFJ1bkN0b3IgfSk7XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgc3JjICguLi5zb3VyY2VzKSB7XG4gICAgICAgIGlmICh0aGlzLmFwaU1ldGhvZFdhc0NhbGxlZC5zcmMpXG4gICAgICAgICAgICB0aHJvdyBuZXcgR2VuZXJhbEVycm9yKFJVTlRJTUVfRVJST1JTLm11bHRpcGxlQVBJTWV0aG9kQ2FsbEZvcmJpZGRlbiwgT1BUSU9OX05BTUVTLnNyYyk7XG5cbiAgICAgICAgc291cmNlcyA9IHRoaXMuX3ByZXBhcmVBcnJheVBhcmFtZXRlcihzb3VyY2VzKTtcbiAgICAgICAgdGhpcy5jb25maWd1cmF0aW9uLm1lcmdlT3B0aW9ucyh7IFtPUFRJT05fTkFNRVMuc3JjXTogc291cmNlcyB9KTtcblxuICAgICAgICB0aGlzLmFwaU1ldGhvZFdhc0NhbGxlZC5zcmMgPSB0cnVlO1xuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIGJyb3dzZXJzICguLi5icm93c2Vycykge1xuICAgICAgICBpZiAodGhpcy5hcGlNZXRob2RXYXNDYWxsZWQuYnJvd3NlcnMpXG4gICAgICAgICAgICB0aHJvdyBuZXcgR2VuZXJhbEVycm9yKFJVTlRJTUVfRVJST1JTLm11bHRpcGxlQVBJTWV0aG9kQ2FsbEZvcmJpZGRlbiwgT1BUSU9OX05BTUVTLmJyb3dzZXJzKTtcblxuICAgICAgICBicm93c2VycyA9IHRoaXMuX3ByZXBhcmVBcnJheVBhcmFtZXRlcihicm93c2Vycyk7XG4gICAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5tZXJnZU9wdGlvbnMoeyBicm93c2VycyB9KTtcblxuICAgICAgICB0aGlzLmFwaU1ldGhvZFdhc0NhbGxlZC5icm93c2VycyA9IHRydWU7XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgY29uY3VycmVuY3kgKGNvbmN1cnJlbmN5KSB7XG4gICAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5tZXJnZU9wdGlvbnMoeyBjb25jdXJyZW5jeSB9KTtcblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICByZXBvcnRlciAobmFtZSwgb3V0cHV0KSB7XG4gICAgICAgIGlmICh0aGlzLmFwaU1ldGhvZFdhc0NhbGxlZC5yZXBvcnRlcilcbiAgICAgICAgICAgIHRocm93IG5ldyBHZW5lcmFsRXJyb3IoUlVOVElNRV9FUlJPUlMubXVsdGlwbGVBUElNZXRob2RDYWxsRm9yYmlkZGVuLCBPUFRJT05fTkFNRVMucmVwb3J0ZXIpO1xuXG4gICAgICAgIGxldCByZXBvcnRlcnMgPSBwcmVwYXJlUmVwb3J0ZXJzKG5hbWUsIG91dHB1dCk7XG5cbiAgICAgICAgcmVwb3J0ZXJzID0gdGhpcy5fcHJlcGFyZUFycmF5UGFyYW1ldGVyKHJlcG9ydGVycyk7XG5cbiAgICAgICAgdGhpcy5jb25maWd1cmF0aW9uLm1lcmdlT3B0aW9ucyh7IFtPUFRJT05fTkFNRVMucmVwb3J0ZXJdOiByZXBvcnRlcnMgfSk7XG5cbiAgICAgICAgdGhpcy5hcGlNZXRob2RXYXNDYWxsZWQucmVwb3J0ZXIgPSB0cnVlO1xuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIGZpbHRlciAoZmlsdGVyKSB7XG4gICAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5tZXJnZU9wdGlvbnMoeyBmaWx0ZXIgfSk7XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgdXNlUHJveHkgKHByb3h5LCBwcm94eUJ5cGFzcykge1xuICAgICAgICB0aGlzLmNvbmZpZ3VyYXRpb24ubWVyZ2VPcHRpb25zKHsgcHJveHksIHByb3h5QnlwYXNzIH0pO1xuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIHNjcmVlbnNob3RzICguLi5vcHRpb25zKSB7XG4gICAgICAgIGxldCBmdWxsUGFnZTtcbiAgICAgICAgbGV0IFtwYXRoLCB0YWtlT25GYWlscywgcGF0aFBhdHRlcm5dID0gb3B0aW9ucztcblxuICAgICAgICBpZiAob3B0aW9ucy5sZW5ndGggPT09IDEgJiYgb3B0aW9uc1swXSAmJiB0eXBlb2Ygb3B0aW9uc1swXSA9PT0gJ29iamVjdCcpXG4gICAgICAgICAgICAoeyBwYXRoLCB0YWtlT25GYWlscywgcGF0aFBhdHRlcm4sIGZ1bGxQYWdlIH0gPSBvcHRpb25zWzBdKTtcblxuICAgICAgICB0aGlzLmNvbmZpZ3VyYXRpb24ubWVyZ2VPcHRpb25zKHsgc2NyZWVuc2hvdHM6IHsgcGF0aCwgdGFrZU9uRmFpbHMsIHBhdGhQYXR0ZXJuLCBmdWxsUGFnZSB9IH0pO1xuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIHZpZGVvIChwYXRoLCBvcHRpb25zLCBlbmNvZGluZ09wdGlvbnMpIHtcbiAgICAgICAgdGhpcy5jb25maWd1cmF0aW9uLm1lcmdlT3B0aW9ucyh7XG4gICAgICAgICAgICBbT1BUSU9OX05BTUVTLnZpZGVvUGF0aF06ICAgICAgICAgICAgcGF0aCxcbiAgICAgICAgICAgIFtPUFRJT05fTkFNRVMudmlkZW9PcHRpb25zXTogICAgICAgICBvcHRpb25zLFxuICAgICAgICAgICAgW09QVElPTl9OQU1FUy52aWRlb0VuY29kaW5nT3B0aW9uc106IGVuY29kaW5nT3B0aW9uc1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICBzdGFydEFwcCAoY29tbWFuZCwgaW5pdERlbGF5KSB7XG4gICAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5tZXJnZU9wdGlvbnMoe1xuICAgICAgICAgICAgW09QVElPTl9OQU1FUy5hcHBDb21tYW5kXTogICBjb21tYW5kLFxuICAgICAgICAgICAgW09QVElPTl9OQU1FUy5hcHBJbml0RGVsYXldOiBpbml0RGVsYXlcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgdHNDb25maWdQYXRoIChwYXRoKSB7XG4gICAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5tZXJnZU9wdGlvbnMoe1xuICAgICAgICAgICAgW09QVElPTl9OQU1FUy50c0NvbmZpZ1BhdGhdOiBwYXRoXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIGNsaWVudFNjcmlwdHMgKC4uLnNjcmlwdHMpIHtcbiAgICAgICAgaWYgKHRoaXMuYXBpTWV0aG9kV2FzQ2FsbGVkLmNsaWVudFNjcmlwdHMpXG4gICAgICAgICAgICB0aHJvdyBuZXcgR2VuZXJhbEVycm9yKFJVTlRJTUVfRVJST1JTLm11bHRpcGxlQVBJTWV0aG9kQ2FsbEZvcmJpZGRlbiwgT1BUSU9OX05BTUVTLmNsaWVudFNjcmlwdHMpO1xuXG4gICAgICAgIHNjcmlwdHMgPSB0aGlzLl9wcmVwYXJlQXJyYXlQYXJhbWV0ZXIoc2NyaXB0cyk7XG5cbiAgICAgICAgdGhpcy5jb25maWd1cmF0aW9uLm1lcmdlT3B0aW9ucyh7IFtPUFRJT05fTkFNRVMuY2xpZW50U2NyaXB0c106IHNjcmlwdHMgfSk7XG5cbiAgICAgICAgdGhpcy5hcGlNZXRob2RXYXNDYWxsZWQuY2xpZW50U2NyaXB0cyA9IHRydWU7XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgYXN5bmMgX3ByZXBhcmVDbGllbnRTY3JpcHRzICh0ZXN0cywgY2xpZW50U2NyaXB0cykge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwodGVzdHMubWFwKGFzeW5jIHRlc3QgPT4ge1xuICAgICAgICAgICAgaWYgKHRlc3QuaXNMZWdhY3kpXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgICAgICBsZXQgbG9hZGVkVGVzdENsaWVudFNjcmlwdHMgPSBhd2FpdCBsb2FkQ2xpZW50U2NyaXB0cyh0ZXN0LmNsaWVudFNjcmlwdHMsIGRpcm5hbWUodGVzdC50ZXN0RmlsZS5maWxlbmFtZSkpO1xuXG4gICAgICAgICAgICBsb2FkZWRUZXN0Q2xpZW50U2NyaXB0cyA9IGNsaWVudFNjcmlwdHMuY29uY2F0KGxvYWRlZFRlc3RDbGllbnRTY3JpcHRzKTtcblxuICAgICAgICAgICAgdGVzdC5jbGllbnRTY3JpcHRzID0gc2V0VW5pcXVlVXJscyhsb2FkZWRUZXN0Q2xpZW50U2NyaXB0cyk7XG4gICAgICAgIH0pKTtcbiAgICB9XG5cbiAgICBydW4gKG9wdGlvbnMgPSB7fSkge1xuICAgICAgICB0aGlzLmFwaU1ldGhvZFdhc0NhbGxlZC5yZXNldCgpO1xuICAgICAgICB0aGlzLmNvbmZpZ3VyYXRpb24ubWVyZ2VPcHRpb25zKG9wdGlvbnMpO1xuICAgICAgICB0aGlzLl9zZXRCb290c3RyYXBwZXJPcHRpb25zKCk7XG5cbiAgICAgICAgY29uc3QgcnVuVGFza1Byb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5fdmFsaWRhdGVSdW5PcHRpb25zKCkpXG4gICAgICAgICAgICAudGhlbigoKSA9PiB0aGlzLl9jcmVhdGVSdW5uYWJsZUNvbmZpZ3VyYXRpb24oKSlcbiAgICAgICAgICAgIC50aGVuKGFzeW5jICh7IHJlcG9ydGVyUGx1Z2lucywgYnJvd3NlclNldCwgdGVzdHMsIHRlc3RlZEFwcCwgY29tbW9uQ2xpZW50U2NyaXB0cyB9KSA9PiB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5fcHJlcGFyZUNsaWVudFNjcmlwdHModGVzdHMsIGNvbW1vbkNsaWVudFNjcmlwdHMpO1xuXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3J1blRhc2socmVwb3J0ZXJQbHVnaW5zLCBicm93c2VyU2V0LCB0ZXN0cywgdGVzdGVkQXBwKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiB0aGlzLl9jcmVhdGVDYW5jZWxhYmxlUHJvbWlzZShydW5UYXNrUHJvbWlzZSk7XG4gICAgfVxuXG4gICAgYXN5bmMgc3RvcCAoKSB7XG4gICAgICAgIC8vIE5PVEU6IFdoZW4gdGFza1Byb21pc2UgaXMgY2FuY2VsbGVkLCBpdCBpcyByZW1vdmVkIGZyb21cbiAgICAgICAgLy8gdGhlIHBlbmRpbmdUYXNrUHJvbWlzZXMgYXJyYXksIHdoaWNoIGxlYWRzIHRvIHNoaWZ0aW5nIGluZGV4ZXNcbiAgICAgICAgLy8gdG93YXJkcyB0aGUgYmVnaW5uaW5nLiBTbywgd2UgbXVzdCBjb3B5IHRoZSBhcnJheSBpbiBvcmRlciB0byBpdGVyYXRlIGl0LFxuICAgICAgICAvLyBvciB3ZSBjYW4gcGVyZm9ybSBpdGVyYXRpb24gZnJvbSB0aGUgZW5kIHRvIHRoZSBiZWdpbm5pbmcuXG4gICAgICAgIGNvbnN0IGNhbmNlbGxhdGlvblByb21pc2VzID0gbWFwUmV2ZXJzZSh0aGlzLnBlbmRpbmdUYXNrUHJvbWlzZXMsIHRhc2tQcm9taXNlID0+IHRhc2tQcm9taXNlLmNhbmNlbCgpKTtcblxuICAgICAgICBhd2FpdCBQcm9taXNlLmFsbChjYW5jZWxsYXRpb25Qcm9taXNlcyk7XG4gICAgfVxufVxuIl19