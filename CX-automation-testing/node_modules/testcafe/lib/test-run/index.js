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
const lodash_1 = require("lodash");
const read_file_relative_1 = require("read-file-relative");
const promisify_event_1 = __importDefault(require("promisify-event"));
const mustache_1 = __importDefault(require("mustache"));
const async_event_emitter_1 = __importDefault(require("../utils/async-event-emitter"));
const debug_log_1 = __importDefault(require("./debug-log"));
const formattable_adapter_1 = __importDefault(require("../errors/test-run/formattable-adapter"));
const error_list_1 = __importDefault(require("../errors/error-list"));
const test_run_1 = require("../errors/test-run/");
const phase_1 = __importDefault(require("./phase"));
const client_messages_1 = __importDefault(require("./client-messages"));
const type_1 = __importDefault(require("./commands/type"));
const delay_1 = __importDefault(require("../utils/delay"));
const marker_symbol_1 = __importDefault(require("./marker-symbol"));
const test_run_tracker_1 = __importDefault(require("../api/test-run-tracker"));
const phase_2 = __importDefault(require("../role/phase"));
const plugin_host_1 = __importDefault(require("../reporter/plugin-host"));
const browser_console_messages_1 = __importDefault(require("./browser-console-messages"));
const unstable_network_mode_1 = require("../browser/connection/unstable-network-mode");
const warning_log_1 = __importDefault(require("../notifications/warning-log"));
const warning_message_1 = __importDefault(require("../notifications/warning-message"));
const testcafe_hammerhead_1 = require("testcafe-hammerhead");
const INJECTABLES = __importStar(require("../assets/injectables"));
const utils_1 = require("../custom-client-scripts/utils");
const get_url_1 = __importDefault(require("../custom-client-scripts/get-url"));
const string_1 = require("../utils/string");
const utils_2 = require("./commands/utils");
const actions_1 = require("./commands/actions");
const types_1 = require("../errors/types");
const process_test_fn_error_1 = __importDefault(require("../errors/process-test-fn-error"));
const lazyRequire = require('import-lazy')(require);
const SessionController = lazyRequire('./session-controller');
const ObservedCallsitesStorage = lazyRequire('./observed-callsites-storage');
const ClientFunctionBuilder = lazyRequire('../client-functions/client-function-builder');
const BrowserManipulationQueue = lazyRequire('./browser-manipulation-queue');
const TestRunBookmark = lazyRequire('./bookmark');
const AssertionExecutor = lazyRequire('../assertions/executor');
const actionCommands = lazyRequire('./commands/actions');
const browserManipulationCommands = lazyRequire('./commands/browser-manipulation');
const serviceCommands = lazyRequire('./commands/service');
const observationCommands = lazyRequire('./commands/observation');
const { executeJsExpression, executeAsyncJsExpression } = lazyRequire('./execute-js-expression');
const TEST_RUN_TEMPLATE = read_file_relative_1.readSync('../client/test-run/index.js.mustache');
const IFRAME_TEST_RUN_TEMPLATE = read_file_relative_1.readSync('../client/test-run/iframe.js.mustache');
const TEST_DONE_CONFIRMATION_RESPONSE = 'test-done-confirmation';
const MAX_RESPONSE_DELAY = 3000;
const CHILD_WINDOW_READY_TIMEOUT = 30 * 1000;
const ALL_DRIVER_TASKS_ADDED_TO_QUEUE_EVENT = 'all-driver-tasks-added-to-queue';
class TestRun extends async_event_emitter_1.default {
    constructor(test, browserConnection, screenshotCapturer, globalWarningLog, opts) {
        super();
        this[marker_symbol_1.default] = true;
        this.warningLog = new warning_log_1.default(globalWarningLog);
        this.opts = opts;
        this.test = test;
        this.browserConnection = browserConnection;
        this.phase = phase_1.default.initial;
        this.driverTaskQueue = [];
        this.testDoneCommandQueued = false;
        this.activeDialogHandler = null;
        this.activeIframeSelector = null;
        this.speed = this.opts.speed;
        this.pageLoadTimeout = this.opts.pageLoadTimeout;
        this.disablePageReloads = test.disablePageReloads || opts.disablePageReloads && test.disablePageReloads !== false;
        this.disablePageCaching = test.disablePageCaching || opts.disablePageCaching;
        this.disableMultipleWindows = opts.disableMultipleWindows;
        this.session = SessionController.getSession(this);
        this.consoleMessages = new browser_console_messages_1.default();
        this.pendingRequest = null;
        this.pendingPageError = null;
        this.controller = null;
        this.ctx = Object.create(null);
        this.fixtureCtx = null;
        this.currentRoleId = null;
        this.usedRoleStates = Object.create(null);
        this.errs = [];
        this.lastDriverStatusId = null;
        this.lastDriverStatusResponse = null;
        this.fileDownloadingHandled = false;
        this.resolveWaitForFileDownloadingPromise = null;
        this.addingDriverTasksCount = 0;
        this.debugging = this.opts.debugMode;
        this.debugOnFail = this.opts.debugOnFail;
        this.disableDebugBreakpoints = false;
        this.debugReporterPluginHost = new plugin_host_1.default({ noColors: false });
        this.browserManipulationQueue = new BrowserManipulationQueue(browserConnection, screenshotCapturer, this.warningLog);
        this.debugLog = new debug_log_1.default(this.browserConnection.userAgent);
        this.quarantine = null;
        this.debugLogger = this.opts.debugLogger;
        this.observedCallsites = new ObservedCallsitesStorage();
        this._addInjectables();
        this._initRequestHooks();
    }
    _addClientScriptContentWarningsIfNecessary() {
        const { empty, duplicatedContent } = utils_1.findProblematicScripts(this.test.clientScripts);
        if (empty.length)
            this.warningLog.addWarning(warning_message_1.default.clientScriptsWithEmptyContent);
        if (duplicatedContent.length) {
            const suffix = string_1.getPluralSuffix(duplicatedContent);
            const duplicatedContentClientScriptsStr = string_1.getConcatenatedValuesString(duplicatedContent, ',\n ');
            this.warningLog.addWarning(warning_message_1.default.clientScriptsWithDuplicatedContent, suffix, duplicatedContentClientScriptsStr);
        }
    }
    _addInjectables() {
        this._addClientScriptContentWarningsIfNecessary();
        this.injectable.scripts.push(...INJECTABLES.SCRIPTS);
        this.injectable.userScripts.push(...this.test.clientScripts.map(script => {
            return {
                url: get_url_1.default(script),
                page: script.page
            };
        }));
        this.injectable.styles.push(INJECTABLES.TESTCAFE_UI_STYLES);
    }
    get id() {
        return this.session.id;
    }
    get injectable() {
        return this.session.injectable;
    }
    addQuarantineInfo(quarantine) {
        this.quarantine = quarantine;
    }
    addRequestHook(hook) {
        if (this.requestHooks.indexOf(hook) !== -1)
            return;
        this.requestHooks.push(hook);
        this._initRequestHook(hook);
    }
    removeRequestHook(hook) {
        if (this.requestHooks.indexOf(hook) === -1)
            return;
        lodash_1.pull(this.requestHooks, hook);
        this._disposeRequestHook(hook);
    }
    _initRequestHook(hook) {
        hook.warningLog = this.warningLog;
        hook._instantiateRequestFilterRules();
        hook._instantiatedRequestFilterRules.forEach(rule => {
            this.session.addRequestEventListeners(rule, {
                onRequest: hook.onRequest.bind(hook),
                onConfigureResponse: hook._onConfigureResponse.bind(hook),
                onResponse: hook.onResponse.bind(hook)
            }, err => this._onRequestHookMethodError(err, hook));
        });
    }
    _onRequestHookMethodError(event, hook) {
        let err = event.error;
        const isRequestHookNotImplementedMethodError = err instanceof test_run_1.RequestHookNotImplementedMethodError;
        if (!isRequestHookNotImplementedMethodError) {
            const hookClassName = hook.constructor.name;
            err = new test_run_1.RequestHookUnhandledError(err, hookClassName, event.methodName);
        }
        this.addError(err);
    }
    _disposeRequestHook(hook) {
        hook.warningLog = null;
        hook._instantiatedRequestFilterRules.forEach(rule => {
            this.session.removeRequestEventListeners(rule);
        });
    }
    _initRequestHooks() {
        this.requestHooks = Array.from(this.test.requestHooks);
        this.requestHooks.forEach(hook => this._initRequestHook(hook));
    }
    // Hammerhead payload
    async getPayloadScript() {
        this.fileDownloadingHandled = false;
        this.resolveWaitForFileDownloadingPromise = null;
        return mustache_1.default.render(TEST_RUN_TEMPLATE, {
            testRunId: JSON.stringify(this.session.id),
            browserId: JSON.stringify(this.browserConnection.id),
            browserHeartbeatRelativeUrl: JSON.stringify(this.browserConnection.heartbeatRelativeUrl),
            browserStatusRelativeUrl: JSON.stringify(this.browserConnection.statusRelativeUrl),
            browserStatusDoneRelativeUrl: JSON.stringify(this.browserConnection.statusDoneRelativeUrl),
            browserActiveWindowIdUrl: JSON.stringify(this.browserConnection.activeWindowIdUrl),
            userAgent: JSON.stringify(this.browserConnection.userAgent),
            testName: JSON.stringify(this.test.name),
            fixtureName: JSON.stringify(this.test.fixture.name),
            selectorTimeout: this.opts.selectorTimeout,
            pageLoadTimeout: this.pageLoadTimeout,
            childWindowReadyTimeout: CHILD_WINDOW_READY_TIMEOUT,
            skipJsErrors: this.opts.skipJsErrors,
            retryTestPages: this.opts.retryTestPages,
            speed: this.speed,
            dialogHandler: JSON.stringify(this.activeDialogHandler),
            canUseDefaultWindowActions: JSON.stringify(await this.browserConnection.canUseDefaultWindowActions())
        });
    }
    async getIframePayloadScript() {
        return mustache_1.default.render(IFRAME_TEST_RUN_TEMPLATE, {
            testRunId: JSON.stringify(this.session.id),
            selectorTimeout: this.opts.selectorTimeout,
            pageLoadTimeout: this.pageLoadTimeout,
            retryTestPages: !!this.opts.retryTestPages,
            speed: this.speed,
            dialogHandler: JSON.stringify(this.activeDialogHandler)
        });
    }
    // Hammerhead handlers
    getAuthCredentials() {
        return this.test.authCredentials;
    }
    handleFileDownload() {
        if (this.resolveWaitForFileDownloadingPromise) {
            this.resolveWaitForFileDownloadingPromise(true);
            this.resolveWaitForFileDownloadingPromise = null;
        }
        else
            this.fileDownloadingHandled = true;
    }
    handlePageError(ctx, err) {
        if (ctx.req.headers[unstable_network_mode_1.UNSTABLE_NETWORK_MODE_HEADER]) {
            ctx.closeWithError(500, err.toString());
            return;
        }
        this.pendingPageError = new test_run_1.PageLoadError(err, ctx.reqOpts.url);
        ctx.redirect(ctx.toProxyUrl(testcafe_hammerhead_1.SPECIAL_ERROR_PAGE));
    }
    // Test function execution
    async _executeTestFn(phase, fn) {
        this.phase = phase;
        try {
            await fn(this);
        }
        catch (err) {
            await this._makeScreenshotOnFail();
            this.addError(err);
            return false;
        }
        finally {
            this.errScreenshotPath = null;
        }
        return !this._addPendingPageErrorIfAny();
    }
    async _runBeforeHook() {
        if (this.test.beforeFn)
            return await this._executeTestFn(phase_1.default.inTestBeforeHook, this.test.beforeFn);
        if (this.test.fixture.beforeEachFn)
            return await this._executeTestFn(phase_1.default.inFixtureBeforeEachHook, this.test.fixture.beforeEachFn);
        return true;
    }
    async _runAfterHook() {
        if (this.test.afterFn)
            return await this._executeTestFn(phase_1.default.inTestAfterHook, this.test.afterFn);
        if (this.test.fixture.afterEachFn)
            return await this._executeTestFn(phase_1.default.inFixtureAfterEachHook, this.test.fixture.afterEachFn);
        return true;
    }
    async start() {
        test_run_tracker_1.default.activeTestRuns[this.session.id] = this;
        await this.emit('start');
        const onDisconnected = err => this._disconnect(err);
        this.browserConnection.once('disconnected', onDisconnected);
        await this.once('connected');
        await this.emit('ready');
        if (await this._runBeforeHook()) {
            await this._executeTestFn(phase_1.default.inTest, this.test.fn);
            await this._runAfterHook();
        }
        if (this.disconnected)
            return;
        this.browserConnection.removeListener('disconnected', onDisconnected);
        if (this.errs.length && this.debugOnFail)
            await this._enqueueSetBreakpointCommand(null, this.debugReporterPluginHost.formatError(this.errs[0]));
        await this.emit('before-done');
        await this.executeCommand(new serviceCommands.TestDoneCommand());
        this._addPendingPageErrorIfAny();
        this.session.clearRequestEventListeners();
        this.normalizeRequestHookErrors();
        delete test_run_tracker_1.default.activeTestRuns[this.session.id];
        await this.emit('done');
    }
    // Errors
    _addPendingPageErrorIfAny() {
        if (this.pendingPageError) {
            this.addError(this.pendingPageError);
            this.pendingPageError = null;
            return true;
        }
        return false;
    }
    _createErrorAdapter(err) {
        return new formattable_adapter_1.default(err, {
            userAgent: this.browserConnection.userAgent,
            screenshotPath: this.errScreenshotPath || '',
            testRunId: this.id,
            testRunPhase: this.phase
        });
    }
    addError(err) {
        const errList = err instanceof error_list_1.default ? err.items : [err];
        errList.forEach(item => {
            const adapter = this._createErrorAdapter(item);
            this.errs.push(adapter);
        });
    }
    normalizeRequestHookErrors() {
        const requestHookErrors = lodash_1.remove(this.errs, e => e.code === types_1.TEST_RUN_ERRORS.requestHookNotImplementedError ||
            e.code === types_1.TEST_RUN_ERRORS.requestHookUnhandledError);
        if (!requestHookErrors.length)
            return;
        const uniqRequestHookErrors = lodash_1.chain(requestHookErrors)
            .uniqBy(e => e.hookClassName + e.methodName)
            .sortBy(['hookClassName', 'methodName'])
            .value();
        this.errs = this.errs.concat(uniqRequestHookErrors);
    }
    // Task queue
    _enqueueCommand(command, callsite) {
        if (this.pendingRequest)
            this._resolvePendingRequest(command);
        return new Promise(async (resolve, reject) => {
            this.addingDriverTasksCount--;
            this.driverTaskQueue.push({ command, resolve, reject, callsite });
            if (!this.addingDriverTasksCount)
                await this.emit(ALL_DRIVER_TASKS_ADDED_TO_QUEUE_EVENT, this.driverTaskQueue.length);
        });
    }
    get driverTaskQueueLength() {
        return this.addingDriverTasksCount ? promisify_event_1.default(this, ALL_DRIVER_TASKS_ADDED_TO_QUEUE_EVENT) : Promise.resolve(this.driverTaskQueue.length);
    }
    async _enqueueBrowserConsoleMessagesCommand(command, callsite) {
        await this._enqueueCommand(command, callsite);
        const consoleMessageCopy = this.consoleMessages.getCopy();
        return consoleMessageCopy[this.browserConnection.activeWindowId];
    }
    async _enqueueSetBreakpointCommand(callsite, error) {
        if (this.browserConnection.isHeadlessBrowser()) {
            this.warningLog.addWarning(warning_message_1.default.debugInHeadlessError);
            return;
        }
        if (this.debugLogger)
            this.debugLogger.showBreakpoint(this.session.id, this.browserConnection.userAgent, callsite, error);
        this.debugging = await this.executeCommand(new serviceCommands.SetBreakpointCommand(!!error), callsite);
    }
    _removeAllNonServiceTasks() {
        this.driverTaskQueue = this.driverTaskQueue.filter(driverTask => utils_2.isServiceCommand(driverTask.command));
        this.browserManipulationQueue.removeAllNonServiceManipulations();
    }
    // Current driver task
    get currentDriverTask() {
        return this.driverTaskQueue[0];
    }
    _resolveCurrentDriverTask(result) {
        this.currentDriverTask.resolve(result);
        this.driverTaskQueue.shift();
        if (this.testDoneCommandQueued)
            this._removeAllNonServiceTasks();
    }
    _rejectCurrentDriverTask(err) {
        err.callsite = err.callsite || this.currentDriverTask.callsite;
        this.currentDriverTask.reject(err);
        this._removeAllNonServiceTasks();
    }
    // Pending request
    _clearPendingRequest() {
        if (this.pendingRequest) {
            clearTimeout(this.pendingRequest.responseTimeout);
            this.pendingRequest = null;
        }
    }
    _resolvePendingRequest(command) {
        this.lastDriverStatusResponse = command;
        this.pendingRequest.resolve(command);
        this._clearPendingRequest();
    }
    // Handle driver request
    _shouldResolveCurrentDriverTask(driverStatus) {
        const currentCommand = this.currentDriverTask.command;
        const isExecutingObservationCommand = currentCommand instanceof observationCommands.ExecuteSelectorCommand ||
            currentCommand instanceof observationCommands.ExecuteClientFunctionCommand;
        const isDebugActive = currentCommand instanceof serviceCommands.SetBreakpointCommand;
        const shouldExecuteCurrentCommand = driverStatus.isFirstRequestAfterWindowSwitching && (isExecutingObservationCommand || isDebugActive);
        return !shouldExecuteCurrentCommand;
    }
    _fulfillCurrentDriverTask(driverStatus) {
        if (!this.currentDriverTask)
            return;
        if (driverStatus.executionError)
            this._rejectCurrentDriverTask(driverStatus.executionError);
        else if (this._shouldResolveCurrentDriverTask(driverStatus))
            this._resolveCurrentDriverTask(driverStatus.result);
    }
    _handlePageErrorStatus(pageError) {
        if (this.currentDriverTask && utils_2.isCommandRejectableByPageError(this.currentDriverTask.command)) {
            this._rejectCurrentDriverTask(pageError);
            this.pendingPageError = null;
            return true;
        }
        this.pendingPageError = this.pendingPageError || pageError;
        return false;
    }
    _handleDriverRequest(driverStatus) {
        const isTestDone = this.currentDriverTask && this.currentDriverTask.command.type ===
            type_1.default.testDone;
        const pageError = this.pendingPageError || driverStatus.pageError;
        const currentTaskRejectedByError = pageError && this._handlePageErrorStatus(pageError);
        if (this.disconnected)
            return new Promise((_, reject) => reject());
        this.consoleMessages.concat(driverStatus.consoleMessages);
        if (!currentTaskRejectedByError && driverStatus.isCommandResult) {
            if (isTestDone) {
                this._resolveCurrentDriverTask();
                return TEST_DONE_CONFIRMATION_RESPONSE;
            }
            this._fulfillCurrentDriverTask(driverStatus);
            if (driverStatus.isPendingWindowSwitching)
                return null;
        }
        return this._getCurrentDriverTaskCommand();
    }
    _getCurrentDriverTaskCommand() {
        if (!this.currentDriverTask)
            return null;
        const command = this.currentDriverTask.command;
        if (command.type === type_1.default.navigateTo && command.stateSnapshot)
            this.session.useStateSnapshot(JSON.parse(command.stateSnapshot));
        return command;
    }
    // Execute command
    _executeJsExpression(command) {
        const resultVariableName = command.resultVariableName;
        let expression = command.expression;
        if (resultVariableName)
            expression = `${resultVariableName} = ${expression}, ${resultVariableName}`;
        return executeJsExpression(expression, this, { skipVisibilityCheck: false });
    }
    async _executeAssertion(command, callsite) {
        const assertionTimeout = command.options.timeout ===
            void 0 ? this.opts.assertionTimeout : command.options.timeout;
        const executor = new AssertionExecutor(command, assertionTimeout, callsite);
        executor.once('start-assertion-retries', timeout => this.executeCommand(new serviceCommands.ShowAssertionRetriesStatusCommand(timeout)));
        executor.once('end-assertion-retries', success => this.executeCommand(new serviceCommands.HideAssertionRetriesStatusCommand(success)));
        const executeFn = this.decoratePreventEmitActionEvents(() => executor.run(), { prevent: true });
        return await executeFn();
    }
    _adjustConfigurationWithCommand(command) {
        if (command.type === type_1.default.testDone) {
            this.testDoneCommandQueued = true;
            if (this.debugLogger)
                this.debugLogger.hideBreakpoint(this.session.id);
        }
        else if (command.type === type_1.default.setNativeDialogHandler)
            this.activeDialogHandler = command.dialogHandler;
        else if (command.type === type_1.default.switchToIframe)
            this.activeIframeSelector = command.selector;
        else if (command.type === type_1.default.switchToMainWindow)
            this.activeIframeSelector = null;
        else if (command.type === type_1.default.setTestSpeed)
            this.speed = command.speed;
        else if (command.type === type_1.default.setPageLoadTimeout)
            this.pageLoadTimeout = command.duration;
        else if (command.type === type_1.default.debug)
            this.debugging = true;
    }
    async _adjustScreenshotCommand(command) {
        const browserId = this.browserConnection.id;
        const { hasChromelessScreenshots } = await this.browserConnection.provider.hasCustomActionForBrowser(browserId);
        if (!hasChromelessScreenshots)
            command.generateScreenshotMark();
    }
    async _setBreakpointIfNecessary(command, callsite) {
        if (!this.disableDebugBreakpoints && this.debugging && utils_2.canSetDebuggerBreakpointBeforeCommand(command))
            await this._enqueueSetBreakpointCommand(callsite);
    }
    async executeAction(apiActionName, command, callsite) {
        const actionArgs = { apiActionName, command };
        let errorAdapter = null;
        let error = null;
        let result = null;
        await this.emitActionEvent('action-start', actionArgs);
        const start = new Date();
        try {
            result = await this.executeCommand(command, callsite);
        }
        catch (err) {
            error = err;
        }
        const duration = new Date() - start;
        if (error) {
            // NOTE: check if error is TestCafeErrorList is specific for the `useRole` action
            // if error is TestCafeErrorList we do not need to create an adapter,
            // since error is already was processed in role initializer
            if (!(error instanceof error_list_1.default)) {
                await this._makeScreenshotOnFail();
                errorAdapter = this._createErrorAdapter(process_test_fn_error_1.default(error));
            }
        }
        Object.assign(actionArgs, {
            result,
            duration,
            err: errorAdapter
        });
        await this.emitActionEvent('action-done', actionArgs);
        if (error)
            throw error;
        return result;
    }
    async executeCommand(command, callsite) {
        this.debugLog.command(command);
        if (this.pendingPageError && utils_2.isCommandRejectableByPageError(command))
            return this._rejectCommandWithPageError(callsite);
        if (utils_2.isExecutableOnClientCommand(command))
            this.addingDriverTasksCount++;
        this._adjustConfigurationWithCommand(command);
        await this._setBreakpointIfNecessary(command, callsite);
        if (utils_2.isScreenshotCommand(command)) {
            if (this.opts.disableScreenshots) {
                this.warningLog.addWarning(warning_message_1.default.screenshotsDisabled);
                return null;
            }
            await this._adjustScreenshotCommand(command);
        }
        if (utils_2.isBrowserManipulationCommand(command)) {
            this.browserManipulationQueue.push(command);
            if (utils_2.isResizeWindowCommand(command) && this.opts.videoPath)
                this.warningLog.addWarning(warning_message_1.default.videoBrowserResizing, this.test.name);
        }
        if (command.type === type_1.default.wait)
            return delay_1.default(command.timeout);
        if (command.type === type_1.default.setPageLoadTimeout)
            return null;
        if (command.type === type_1.default.debug)
            return await this._enqueueSetBreakpointCommand(callsite);
        if (command.type === type_1.default.useRole) {
            let fn = () => this._useRole(command.role, callsite);
            fn = this.decoratePreventEmitActionEvents(fn, { prevent: true });
            fn = this.decorateDisableDebugBreakpoints(fn, { disable: true });
            return await fn();
        }
        if (command.type === type_1.default.assertion)
            return this._executeAssertion(command, callsite);
        if (command.type === type_1.default.executeExpression)
            return await this._executeJsExpression(command, callsite);
        if (command.type === type_1.default.executeAsyncExpression)
            return await executeAsyncJsExpression(command.expression, this, callsite);
        if (command.type === type_1.default.getBrowserConsoleMessages)
            return await this._enqueueBrowserConsoleMessagesCommand(command, callsite);
        if (command.type === type_1.default.switchToPreviousWindow)
            command.windowId = this.browserConnection.previousActiveWindowId;
        if (command.type === type_1.default.switchToWindowByPredicate)
            return this._switchToWindowByPredicate(command);
        return this._enqueueCommand(command, callsite);
    }
    _rejectCommandWithPageError(callsite) {
        const err = this.pendingPageError;
        err.callsite = callsite;
        this.pendingPageError = null;
        return Promise.reject(err);
    }
    async _makeScreenshotOnFail() {
        const { screenshots } = this.opts;
        if (!this.errScreenshotPath && screenshots && screenshots.takeOnFails)
            this.errScreenshotPath = await this.executeCommand(new browserManipulationCommands.TakeScreenshotOnFailCommand());
    }
    _decorateWithFlag(fn, flagName, value) {
        return async () => {
            this[flagName] = value;
            try {
                return await fn();
            }
            catch (err) {
                throw err;
            }
            finally {
                this[flagName] = !value;
            }
        };
    }
    decoratePreventEmitActionEvents(fn, { prevent }) {
        return this._decorateWithFlag(fn, 'preventEmitActionEvents', prevent);
    }
    decorateDisableDebugBreakpoints(fn, { disable }) {
        return this._decorateWithFlag(fn, 'disableDebugBreakpoints', disable);
    }
    // Role management
    async getStateSnapshot() {
        const state = this.session.getStateSnapshot();
        state.storages = await this.executeCommand(new serviceCommands.BackupStoragesCommand());
        return state;
    }
    async switchToCleanRun(url) {
        this.ctx = Object.create(null);
        this.fixtureCtx = Object.create(null);
        this.consoleMessages = new browser_console_messages_1.default();
        this.session.useStateSnapshot(testcafe_hammerhead_1.StateSnapshot.empty());
        if (this.speed !== this.opts.speed) {
            const setSpeedCommand = new actionCommands.SetTestSpeedCommand({ speed: this.opts.speed });
            await this.executeCommand(setSpeedCommand);
        }
        if (this.pageLoadTimeout !== this.opts.pageLoadTimeout) {
            const setPageLoadTimeoutCommand = new actionCommands.SetPageLoadTimeoutCommand({ duration: this.opts.pageLoadTimeout });
            await this.executeCommand(setPageLoadTimeoutCommand);
        }
        await this.navigateToUrl(url, true);
        if (this.activeDialogHandler) {
            const removeDialogHandlerCommand = new actionCommands.SetNativeDialogHandlerCommand({ dialogHandler: { fn: null } });
            await this.executeCommand(removeDialogHandlerCommand);
        }
    }
    async navigateToUrl(url, forceReload, stateSnapshot) {
        const navigateCommand = new actionCommands.NavigateToCommand({ url, forceReload, stateSnapshot });
        await this.executeCommand(navigateCommand);
    }
    async _getStateSnapshotFromRole(role) {
        const prevPhase = this.phase;
        this.phase = phase_1.default.inRoleInitializer;
        if (role.phase === phase_2.default.uninitialized)
            await role.initialize(this);
        else if (role.phase === phase_2.default.pendingInitialization)
            await promisify_event_1.default(role, 'initialized');
        if (role.initErr)
            throw role.initErr;
        this.phase = prevPhase;
        return role.stateSnapshot;
    }
    async _useRole(role, callsite) {
        if (this.phase === phase_1.default.inRoleInitializer)
            throw new test_run_1.RoleSwitchInRoleInitializerError(callsite);
        const bookmark = new TestRunBookmark(this, role);
        await bookmark.init();
        if (this.currentRoleId)
            this.usedRoleStates[this.currentRoleId] = await this.getStateSnapshot();
        const stateSnapshot = this.usedRoleStates[role.id] || await this._getStateSnapshotFromRole(role);
        this.session.useStateSnapshot(stateSnapshot);
        this.currentRoleId = role.id;
        await bookmark.restore(callsite, stateSnapshot);
    }
    async getCurrentUrl() {
        const builder = new ClientFunctionBuilder(() => {
            /* eslint-disable no-undef */
            return window.location.href;
            /* eslint-enable no-undef */
        }, { boundTestRun: this });
        const getLocation = builder.getFunction();
        return await getLocation();
    }
    async _switchToWindowByPredicate(command) {
        const currentWindows = await this.executeCommand(new actions_1.GetCurrentWindowsCommand({}, this));
        const windows = currentWindows.filter(wnd => {
            try {
                const url = new URL(wnd.url);
                return command.findWindow({ url, title: wnd.title });
            }
            catch (e) {
                throw new test_run_1.SwitchToWindowPredicateError(e.message);
            }
        });
        if (!windows.length)
            throw new test_run_1.WindowNotFoundError();
        if (windows.length > 1)
            this.warningLog.addWarning(warning_message_1.default.multipleWindowsFoundByPredicate);
        await this.executeCommand(new actions_1.SwitchToWindowCommand({ windowId: windows[0].id }), this);
    }
    _disconnect(err) {
        this.disconnected = true;
        if (this.currentDriverTask)
            this._rejectCurrentDriverTask(err);
        this.emit('disconnected', err);
        delete test_run_tracker_1.default.activeTestRuns[this.session.id];
    }
    async emitActionEvent(eventName, args) {
        if (!this.preventEmitActionEvents)
            await this.emit(eventName, args);
    }
    static isMultipleWindowsAllowed(testRun) {
        const { disableMultipleWindows, test, browserConnection } = testRun;
        return !disableMultipleWindows && !test.isLegacy && !!browserConnection.activeWindowId;
    }
}
exports.default = TestRun;
// Service message handlers
const ServiceMessages = TestRun.prototype;
// NOTE: this function is time-critical and must return ASAP to avoid client disconnection
ServiceMessages[client_messages_1.default.ready] = function (msg) {
    this.debugLog.driverMessage(msg);
    this.emit('connected');
    this._clearPendingRequest();
    // NOTE: the driver sends the status for the second time if it didn't get a response at the
    // first try. This is possible when the page was unloaded after the driver sent the status.
    if (msg.status.id === this.lastDriverStatusId)
        return this.lastDriverStatusResponse;
    this.lastDriverStatusId = msg.status.id;
    this.lastDriverStatusResponse = this._handleDriverRequest(msg.status);
    if (this.lastDriverStatusResponse || msg.status.isPendingWindowSwitching)
        return this.lastDriverStatusResponse;
    // NOTE: we send an empty response after the MAX_RESPONSE_DELAY timeout is exceeded to keep connection
    // with the client and prevent the response timeout exception on the client side
    const responseTimeout = setTimeout(() => this._resolvePendingRequest(null), MAX_RESPONSE_DELAY);
    return new Promise((resolve, reject) => {
        this.pendingRequest = { resolve, reject, responseTimeout };
    });
};
ServiceMessages[client_messages_1.default.readyForBrowserManipulation] = async function (msg) {
    this.debugLog.driverMessage(msg);
    let result = null;
    let error = null;
    try {
        result = await this.browserManipulationQueue.executePendingManipulation(msg);
    }
    catch (err) {
        error = err;
    }
    return { result, error };
};
ServiceMessages[client_messages_1.default.waitForFileDownload] = function (msg) {
    this.debugLog.driverMessage(msg);
    return new Promise(resolve => {
        if (this.fileDownloadingHandled) {
            this.fileDownloadingHandled = false;
            resolve(true);
        }
        else
            this.resolveWaitForFileDownloadingPromise = resolve;
    });
};
module.exports = exports.default;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvdGVzdC1ydW4vaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsbUNBSWdCO0FBRWhCLDJEQUFzRDtBQUN0RCxzRUFBNkM7QUFDN0Msd0RBQWdDO0FBQ2hDLHVGQUE2RDtBQUM3RCw0REFBMEM7QUFDMUMsaUdBQW9GO0FBQ3BGLHNFQUFxRDtBQUNyRCxrREFPNkI7QUFFN0Isb0RBQTRCO0FBQzVCLHdFQUFnRDtBQUNoRCwyREFBMkM7QUFDM0MsMkRBQW1DO0FBQ25DLG9FQUE0QztBQUM1QywrRUFBcUQ7QUFDckQsMERBQXVDO0FBQ3ZDLDBFQUF5RDtBQUN6RCwwRkFBZ0U7QUFDaEUsdUZBQTJGO0FBQzNGLCtFQUFzRDtBQUN0RCx1RkFBK0Q7QUFDL0QsNkRBQXdFO0FBQ3hFLG1FQUFxRDtBQUNyRCwwREFBd0U7QUFDeEUsK0VBQXdFO0FBQ3hFLDRDQUErRTtBQUUvRSw0Q0FRMEI7QUFFMUIsZ0RBQXFGO0FBRXJGLDJDQUFrRDtBQUNsRCw0RkFBaUU7QUFFakUsTUFBTSxXQUFXLEdBQW1CLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQztBQUNwRSxNQUFNLGlCQUFpQixHQUFhLFdBQVcsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDO0FBQ3hFLE1BQU0sd0JBQXdCLEdBQU0sV0FBVyxDQUFDLDhCQUE4QixDQUFDLENBQUM7QUFDaEYsTUFBTSxxQkFBcUIsR0FBUyxXQUFXLENBQUMsNkNBQTZDLENBQUMsQ0FBQztBQUMvRixNQUFNLHdCQUF3QixHQUFNLFdBQVcsQ0FBQyw4QkFBOEIsQ0FBQyxDQUFDO0FBQ2hGLE1BQU0sZUFBZSxHQUFlLFdBQVcsQ0FBQyxZQUFZLENBQUMsQ0FBQztBQUM5RCxNQUFNLGlCQUFpQixHQUFhLFdBQVcsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDO0FBQzFFLE1BQU0sY0FBYyxH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QUFHLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxlQUFlLEVBQUUsQ0FBQztJQUMvRCxDQUFDLENBQUMsQ0FBQztBQUNQLENBQUMsQ0FBQztBQUVGLGVBQWUsQ0FBQyx5QkFBZSxDQUFDLDJCQUEyQixDQUFDLEdBQUcsS0FBSyxXQUFXLEdBQUc7SUFDOUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLENBQUM7SUFFakMsSUFBSSxNQUFNLEdBQUcsSUFBSSxDQUFDO0lBQ2xCLElBQUksS0FBSyxHQUFJLElBQUksQ0FBQztJQUVsQixJQUFJO1FBQ0EsTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLHdCQUF3QixDQUFDLDBCQUEwQixDQUFDLEdBQUcsQ0FBQyxDQUFDO0tBQ2hGO0lBQ0QsT0FBTyxHQUFHLEVBQUU7UUFDUixLQUFLLEdBQUcsR0FBRyxDQUFDO0tBQ2Y7SUFFRCxPQUFPLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxDQUFDO0FBQzdCLENBQUMsQ0FBQztBQUVGLGVBQWUsQ0FBQyx5QkFBZSxDQUFDLG1CQUFtQixDQUFDLEdBQUcsVUFBVSxHQUFHO0lBQ2hFLElBQUksQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBRWpDLE9BQU8sSUFBSSxPQUFPLENBQUMsT0FBTyxDQUFDLEVBQUU7UUFDekIsSUFBSSxJQUFJLENBQUMsc0JBQXNCLEVBQUU7WUFDN0IsSUFBSSxDQUFDLHNCQUFzQixHQUFHLEtBQUssQ0FBQztZQUNwQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUM7U0FDakI7O1lBRUcsSUFBSSxDQUFDLG9DQUFvQyxHQUFHLE9BQU8sQ0FBQztJQUM1RCxDQUFDLENBQUMsQ0FBQztBQUNQLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7XG4gICAgcHVsbCxcbiAgICByZW1vdmUsXG4gICAgY2hhaW5cbn0gZnJvbSAnbG9kYXNoJztcblxuaW1wb3J0IHsgcmVhZFN5bmMgYXMgcmVhZCB9IGZyb20gJ3JlYWQtZmlsZS1yZWxhdGl2ZSc7XG5pbXBvcnQgcHJvbWlzaWZ5RXZlbnQgZnJvbSAncHJvbWlzaWZ5LWV2ZW50JztcbmltcG9ydCBNdXN0YWNoZSBmcm9tICdtdXN0YWNoZSc7XG5pbXBvcnQgQXN5bmNFdmVudEVtaXR0ZXIgZnJvbSAnLi4vdXRpbHMvYXN5bmMtZXZlbnQtZW1pdHRlcic7XG5pbXBvcnQgVGVzdFJ1bkRlYnVnTG9nIGZyb20gJy4vZGVidWctbG9nJztcbmltcG9ydCBUZXN0UnVuRXJyb3JGb3JtYXR0YWJsZUFkYXB0ZXIgZnJvbSAnLi4vZXJyb3JzL3Rlc3QtcnVuL2Zvcm1hdHRhYmxlLWFkYXB0ZXInO1xuaW1wb3J0IFRlc3RDYWZlRXJyb3JMaXN0IGZyb20gJy4uL2Vycm9ycy9lcnJvci1saXN0JztcbmltcG9ydCB7XG4gICAgUmVxdWVzdEhvb2tVbmhhbmRsZWRFcnJvcixcbiAgICBQYWdlTG9hZEVycm9yLFxuICAgIFJlcXVlc3RIb29rTm90SW1wbGVtZW50ZWRNZXRob2RFcnJvcixcbiAgICBSb2xlU3dpdGNoSW5Sb2xlSW5pdGlhbGl6ZXJFcnJvcixcbiAgICBTd2l0Y2hUb1dpbmRvd1ByZWRpY2F0ZUVycm9yLFxuICAgIFdpbmRvd05vdEZvdW5kRXJyb3Jcbn0gZnJvbSAnLi4vZXJyb3JzL3Rlc3QtcnVuLyc7XG5cbmltcG9ydCBQSEFTRSBmcm9tICcuL3BoYXNlJztcbmltcG9ydCBDTElFTlRfTUVTU0FHRVMgZnJvbSAnLi9jbGllbnQtbWVzc2FnZXMnO1xuaW1wb3J0IENPTU1BTkRfVFlQRSBmcm9tICcuL2NvbW1hbmRzL3R5cGUnO1xuaW1wb3J0IGRlbGF5IGZyb20gJy4uL3V0aWxzL2RlbGF5JztcbmltcG9ydCB0ZXN0UnVuTWFya2VyIGZyb20gJy4vbWFya2VyLXN5bWJvbCc7XG5pbXBvcnQgdGVzdFJ1blRyYWNrZXIgZnJvbSAnLi4vYXBpL3Rlc3QtcnVuLXRyYWNrZXInO1xuaW1wb3J0IFJPTEVfUEhBU0UgZnJvbSAnLi4vcm9sZS9waGFzZSc7XG5pbXBvcnQgUmVwb3J0ZXJQbHVnaW5Ib3N0IGZyb20gJy4uL3JlcG9ydGVyL3BsdWdpbi1ob3N0JztcbmltcG9ydCBCcm93c2VyQ29uc29sZU1lc3NhZ2VzIGZyb20gJy4vYnJvd3Nlci1jb25zb2xlLW1lc3NhZ2VzJztcbmltcG9ydCB7IFVOU1RBQkxFX05FVFdPUktfTU9ERV9IRUFERVIgfSBmcm9tICcuLi9icm93c2VyL2Nvbm5lY3Rpb24vdW5zdGFibGUtbmV0d29yay1tb2RlJztcbmltcG9ydCBXYXJuaW5nTG9nIGZyb20gJy4uL25vdGlmaWNhdGlvbnMvd2FybmluZy1sb2cnO1xuaW1wb3J0IFdBUk5JTkdfTUVTU0FHRSBmcm9tICcuLi9ub3RpZmljYXRpb25zL3dhcm5pbmctbWVzc2FnZSc7XG5pbXBvcnQgeyBTdGF0ZVNuYXBzaG90LCBTUEVDSUFMX0VSUk9SX1BBR0UgfSBmcm9tICd0ZXN0Y2FmZS1oYW1tZXJoZWFkJztcbmltcG9ydCAqIGFzIElOSkVDVEFCTEVTIGZyb20gJy4uL2Fzc2V0cy9pbmplY3RhYmxlcyc7XG5pbXBvcnQgeyBmaW5kUHJvYmxlbWF0aWNTY3JpcHRzIH0gZnJvbSAnLi4vY3VzdG9tLWNsaWVudC1zY3JpcHRzL3V0aWxzJztcbmltcG9ydCBnZXRDdXN0b21DbGllbnRTY3JpcHRVcmwgZnJvbSAnLi4vY3VzdG9tLWNsaWVudC1zY3JpcHRzL2dldC11cmwnO1xuaW1wb3J0IHsgZ2V0UGx1cmFsU3VmZml4LCBnZXRDb25jYXRlbmF0ZWRWYWx1ZXNTdHJpbmcgfSBmcm9tICcuLi91dGlscy9zdHJpbmcnO1xuXG5pbXBvcnQge1xuICAgIGlzQ29tbWFuZFJlamVjdGFibGVCeVBhZ2VFcnJvcixcbiAgICBpc0Jyb3dzZXJNYW5pcHVsYXRpb25Db21tYW5kLFxuICAgIGlzU2NyZWVuc2hvdENvbW1hbmQsXG4gICAgaXNTZXJ2aWNlQ29tbWFuZCxcbiAgICBjYW5TZXREZWJ1Z2dlckJyZWFrcG9pbnRCZWZvcmVDb21tYW5kLFxuICAgIGlzRXhlY3V0YWJsZU9uQ2xpZW50Q29tbWFuZCxcbiAgICBpc1Jlc2l6ZVdpbmRvd0NvbW1hbmRcbn0gZnJvbSAnLi9jb21tYW5kcy91dGlscyc7XG5cbmltcG9ydCB7IEdldEN1cnJlbnRXaW5kb3dzQ29tbWFuZCwgU3dpdGNoVG9XaW5kb3dDb21tYW5kIH0gZnJvbSAnLi9jb21tYW5kcy9hY3Rpb25zJztcblxuaW1wb3J0IHsgVEVTVF9SVU5fRVJST1JTIH0gZnJvbSAnLi4vZXJyb3JzL3R5cGVzJztcbmltcG9ydCBwcm9jZXNzVGVzdEZuRXJyb3IgZnJvbSAnLi4vZXJyb3JzL3Byb2Nlc3MtdGVzdC1mbi1lcnJvcic7XG5cbmNvbnN0IGxhenlSZXF1aXJlICAgICAgICAgICAgICAgICA9IHJlcXVpcmUoJ2ltcG9ydC1sYXp5JykocmVxdWlyZSk7XG5jb25zdCBTZXNzaW9uQ29udHJvbGxlciAgICAgICAgICAgPSBsYXp5UmVxdWlyZSgnLi9zZXNzaW9uLWNvbnRyb2xsZXInKTtcbmNvbnN0IE9ic2VydmVkQ2FsbHNpdGVzU3RvcmFnZSAgICA9IGxhenlSZXF1aXJlKCcuL29ic2VydmVkLWNhbGxzaXRlcy1zdG9yYWdlJyk7XG5jb25zdCBDbGllbnRGdW5jdGlvbkJ1aWxkZXIgICAgICAgPSBsYXp5UmVxdWlyZSgnLi4vY2xpZW50LWZ1bmN0aW9ucy9jbGllbnQtZnVuY3Rpb24tYnVpbGRlcicpO1xuY29uc3QgQnJvd3Nlck1hbmlwdWxhdGlvblF1ZXVlICAgID0gbGF6eVJlcXVpcmUoJy4vYnJvd3Nlci1tYW5pcHVsYXRpb24tcXVldWUnKTtcbmNvbnN0IFRlc3RSdW5Cb29rbWFyayAgICAgICAgICAgICA9IGxhenlSZXF1aXJlKCcuL2Jvb2ttYXJrJyk7XG5jb25zdCBBc3NlcnRpb25FeGVjdXRvciAgICAgICAgICAgPSBsYXp5UmVxdWlyZSgnLi4vYXNzZXJ0aW9ucy9leGVjdXRvcicpO1xuY29uc3QgYWN0aW9uQ29tbWFuZHMgICAgICAgICAgICAgID0gbGF6eVJlcXVpcmUoJy4vY29tbWFuZHMvYWN0aW9ucycpO1xuY29uc3QgYnJvd3Nlck1hbmlwdWxhdGlvbkNvbW1hbmRzID0gbGF6eVJlcXVpcmUoJy4vY29tbWFuZHMvYnJvd3Nlci1tYW5pcHVsYXRpb24nKTtcbmNvbnN0IHNlcnZpY2VDb21tYW5kcyAgICAgICAgICAgICA9IGxhenlSZXF1aXJlKCcuL2NvbW1hbmRzL3NlcnZpY2UnKTtcbmNvbnN0IG9ic2VydmF0aW9uQ29tbWFuZHMgICAgICAgICA9IGxhenlSZXF1aXJlKCcuL2NvbW1hbmRzL29ic2VydmF0aW9uJyk7XG5cbmNvbnN0IHsgZXhlY3V0ZUpzRXhwcmVzc2lvbiwgZXhlY3V0ZUFzeW5jSnNFeHByZXNzaW9uIH0gPSBsYXp5UmVxdWlyZSgnLi9leGVjdXRlLWpzLWV4cHJlc3Npb24nKTtcblxuY29uc3QgVEVTVF9SVU5fVEVNUExBVEUgICAgICAgICAgICAgICA9IHJlYWQoJy4uL2NsaWVudC90ZXN0LXJ1bi9pbmRleC5qcy5tdXN0YWNoZScpO1xuY29uc3QgSUZSQU1FX1RFU1RfUlVOX1RFTVBMQVRFICAgICAgICA9IHJlYWQoJy4uL2NsaWVudC90ZXN0LXJ1bi9pZnJhbWUuanMubXVzdGFjaGUnKTtcbmNvbnN0IFRFU1RfRE9ORV9DT05GSVJNQVRJT05fUkVTUE9OU0UgPSAndGVzdC1kb25lLWNvbmZpcm1hdGlvbic7XG5jb25zdCBNQVhfUkVTUE9OU0VfREVMQVkgICAgICAgICAgICAgID0gMzAwMDtcbmNvbnN0IENISUxEX1dJTkRPV19SRUFEWV9USU1FT1VUICAgICAgPSAzMCAqIDEwMDA7XG5cbmNvbnN0IEFMTF9EUklWRVJfVEFTS1NfQURERURfVE9fUVVFVUVfRVZFTlQgPSAnYWxsLWRyaXZlci10YXNrcy1hZGRlZC10by1xdWV1ZSc7XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFRlc3RSdW4gZXh0ZW5kcyBBc3luY0V2ZW50RW1pdHRlciB7XG4gICAgY29uc3RydWN0b3IgKHRlc3QsIGJyb3dzZXJDb25uZWN0aW9uLCBzY3JlZW5zaG90Q2FwdHVyZXIsIGdsb2JhbFdhcm5pbmdMb2csIG9wdHMpIHtcbiAgICAgICAgc3VwZXIoKTtcblxuICAgICAgICB0aGlzW3Rlc3RSdW5NYXJrZXJdID0gdHJ1ZTtcblxuICAgICAgICB0aGlzLndhcm5pbmdMb2cgPSBuZXcgV2FybmluZ0xvZyhnbG9iYWxXYXJuaW5nTG9nKTtcblxuICAgICAgICB0aGlzLm9wdHMgICAgICAgICAgICAgID0gb3B0cztcbiAgICAgICAgdGhpcy50ZXN0ICAgICAgICAgICAgICA9IHRlc3Q7XG4gICAgICAgIHRoaXMuYnJvd3NlckNvbm5lY3Rpb24gPSBicm93c2VyQ29ubmVjdGlvbjtcblxuICAgICAgICB0aGlzLnBoYXNlID0gUEhBU0UuaW5pdGlhbDtcblxuICAgICAgICB0aGlzLmRyaXZlclRhc2tRdWV1ZSAgICAgICA9IFtdO1xuICAgICAgICB0aGlzLnRlc3REb25lQ29tbWFuZFF1ZXVlZCA9IGZhbHNlO1xuXG4gICAgICAgIHRoaXMuYWN0aXZlRGlhbG9nSGFuZGxlciAgPSBudWxsO1xuICAgICAgICB0aGlzLmFjdGl2ZUlmcmFtZVNlbGVjdG9yID0gbnVsbDtcbiAgICAgICAgdGhpcy5zcGVlZCAgICAgICAgICAgICAgICA9IHRoaXMub3B0cy5zcGVlZDtcbiAgICAgICAgdGhpcy5wYWdlTG9hZFRpbWVvdXQgICAgICA9IHRoaXMub3B0cy5wYWdlTG9hZFRpbWVvdXQ7XG5cbiAgICAgICAgdGhpcy5kaXNhYmxlUGFnZVJlbG9hZHMgICA9IHRlc3QuZGlzYWJsZVBhZ2VSZWxvYWRzIHx8IG9wdHMuZGlzYWJsZVBhZ2VSZWxvYWRzICYmIHRlc3QuZGlzYWJsZVBhZ2VSZWxvYWRzICE9PSBmYWxzZTtcbiAgICAgICAgdGhpcy5kaXNhYmxlUGFnZUNhY2hpbmcgICA9IHRlc3QuZGlzYWJsZVBhZ2VDYWNoaW5nIHx8IG9wdHMuZGlzYWJsZVBhZ2VDYWNoaW5nO1xuXG4gICAgICAgIHRoaXMuZGlzYWJsZU11bHRpcGxlV2luZG93cyA9IG9wdHMuZGlzYWJsZU11bHRpcGxlV2luZG93cztcblxuICAgICAgICB0aGlzLnNlc3Npb24gPSBTZXNzaW9uQ29udHJvbGxlci5nZXRTZXNzaW9uKHRoaXMpO1xuXG4gICAgICAgIHRoaXMuY29uc29sZU1lc3NhZ2VzID0gbmV3IEJyb3dzZXJDb25zb2xlTWVzc2FnZXMoKTtcblxuICAgICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0ICAgPSBudWxsO1xuICAgICAgICB0aGlzLnBlbmRpbmdQYWdlRXJyb3IgPSBudWxsO1xuXG4gICAgICAgIHRoaXMuY29udHJvbGxlciA9IG51bGw7XG4gICAgICAgIHRoaXMuY3R4ICAgICAgICA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG4gICAgICAgIHRoaXMuZml4dHVyZUN0eCA9IG51bGw7XG5cbiAgICAgICAgdGhpcy5jdXJyZW50Um9sZUlkICA9IG51bGw7XG4gICAgICAgIHRoaXMudXNlZFJvbGVTdGF0ZXMgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuXG4gICAgICAgIHRoaXMuZXJycyA9IFtdO1xuXG4gICAgICAgIHRoaXMubGFzdERyaXZlclN0YXR1c0lkICAgICAgID0gbnVsbDtcbiAgICAgICAgdGhpcy5sYXN0RHJpdmVyU3RhdHVzUmVzcG9uc2UgPSBudWxsO1xuXG4gICAgICAgIHRoaXMuZmlsZURvd25sb2FkaW5nSGFuZGxlZCAgICAgICAgICAgICAgID0gZmFsc2U7XG4gICAgICAgIHRoaXMucmVzb2x2ZVdhaXRGb3JGaWxlRG93bmxvYWRpbmdQcm9taXNlID0gbnVsbDtcblxuICAgICAgICB0aGlzLmFkZGluZ0RyaXZlclRhc2tzQ291bnQgPSAwO1xuXG4gICAgICAgIHRoaXMuZGVidWdnaW5nICAgICAgICAgICAgICAgPSB0aGlzLm9wdHMuZGVidWdNb2RlO1xuICAgICAgICB0aGlzLmRlYnVnT25GYWlsICAgICAgICAgICAgID0gdGhpcy5vcHRzLmRlYnVnT25GYWlsO1xuICAgICAgICB0aGlzLmRpc2FibGVEZWJ1Z0JyZWFrcG9pbnRzID0gZmFsc2U7XG4gICAgICAgIHRoaXMuZGVidWdSZXBvcnRlclBsdWdpbkhvc3QgPSBuZXcgUmVwb3J0ZXJQbHVnaW5Ib3N0KHsgbm9Db2xvcnM6IGZhbHNlIH0pO1xuXG4gICAgICAgIHRoaXMuYnJvd3Nlck1hbmlwdWxhdGlvblF1ZXVlID0gbmV3IEJyb3dzZXJNYW5pcHVsYXRpb25RdWV1ZShicm93c2VyQ29ubmVjdGlvbiwgc2NyZWVuc2hvdENhcHR1cmVyLCB0aGlzLndhcm5pbmdMb2cpO1xuXG4gICAgICAgIHRoaXMuZGVidWdMb2cgPSBuZXcgVGVzdFJ1bkRlYnVnTG9nKHRoaXMuYnJvd3NlckNvbm5lY3Rpb24udXNlckFnZW50KTtcblxuICAgICAgICB0aGlzLnF1YXJhbnRpbmUgID0gbnVsbDtcblxuICAgICAgICB0aGlzLmRlYnVnTG9nZ2VyID0gdGhpcy5vcHRzLmRlYnVnTG9nZ2VyO1xuXG4gICAgICAgIHRoaXMub2JzZXJ2ZWRDYWxsc2l0ZXMgPSBuZXcgT2JzZXJ2ZWRDYWxsc2l0ZXNTdG9yYWdlKCk7XG5cbiAgICAgICAgdGhpcy5fYWRkSW5qZWN0YWJsZXMoKTtcbiAgICAgICAgdGhpcy5faW5pdFJlcXVlc3RIb29rcygpO1xuICAgIH1cblxuICAgIF9hZGRDbGllbnRTY3JpcHRDb250ZW50V2FybmluZ3NJZk5lY2Vzc2FyeSAoKSB7XG4gICAgICAgIGNvbnN0IHsgZW1wdHksIGR1cGxpY2F0ZWRDb250ZW50IH0gPSBmaW5kUHJvYmxlbWF0aWNTY3JpcHRzKHRoaXMudGVzdC5jbGllbnRTY3JpcHRzKTtcblxuICAgICAgICBpZiAoZW1wdHkubGVuZ3RoKVxuICAgICAgICAgICAgdGhpcy53YXJuaW5nTG9nLmFkZFdhcm5pbmcoV0FSTklOR19NRVNTQUdFLmNsaWVudFNjcmlwdHNXaXRoRW1wdHlDb250ZW50KTtcblxuICAgICAgICBpZiAoZHVwbGljYXRlZENvbnRlbnQubGVuZ3RoKSB7XG4gICAgICAgICAgICBjb25zdCBzdWZmaXggICAgICAgICAgICAgICAgICAgICAgICAgICAgPSBnZXRQbHVyYWxTdWZmaXgoZHVwbGljYXRlZENvbnRlbnQpO1xuICAgICAgICAgICAgY29uc3QgZHVwbGljYXRlZENvbnRlbnRDbGllbnRTY3JpcHRzU3RyID0gZ2V0Q29uY2F0ZW5hdGVkVmFsdWVzU3RyaW5nKGR1cGxpY2F0ZWRDb250ZW50LCAnLFxcbiAnKTtcblxuICAgICAgICAgICAgdGhpcy53YXJuaW5nTG9nLmFkZFdhcm5pbmcoV0FSTklOR19NRVNTQUdFLmNsaWVudFNjcmlwdHNXaXRoRHVwbGljYXRlZENvbnRlbnQsIHN1ZmZpeCwgZHVwbGljYXRlZENvbnRlbnRDbGllbnRTY3JpcHRzU3RyKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIF9hZGRJbmplY3RhYmxlcyAoKSB7XG4gICAgICAgIHRoaXMuX2FkZENsaWVudFNjcmlwdENvbnRlbnRXYXJuaW5nc0lmTmVjZXNzYXJ5KCk7XG4gICAgICAgIHRoaXMuaW5qZWN0YWJsZS5zY3JpcHRzLnB1c2goLi4uSU5KRUNUQUJMRVMuU0NSSVBUUyk7XG4gICAgICAgIHRoaXMuaW5qZWN0YWJsZS51c2VyU2NyaXB0cy5wdXNoKC4uLnRoaXMudGVzdC5jbGllbnRTY3JpcHRzLm1hcChzY3JpcHQgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICB1cmw6ICBnZXRDdXN0b21DbGllbnRTY3JpcHRVcmwoc2NyaXB0KSxcbiAgICAgICAgICAgICAgICBwYWdlOiBzY3JpcHQucGFnZVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfSkpO1xuICAgICAgICB0aGlzLmluamVjdGFibGUuc3R5bGVzLnB1c2goSU5KRUNUQUJMRVMuVEVTVENBRkVfVUlfU1RZTEVTKTtcbiAgICB9XG5cbiAgICBnZXQgaWQgKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5zZXNzaW9uLmlkO1xuICAgIH1cblxuICAgIGdldCBpbmplY3RhYmxlICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc2Vzc2lvbi5pbmplY3RhYmxlO1xuICAgIH1cblxuICAgIGFkZFF1YXJhbnRpbmVJbmZvIChxdWFyYW50aW5lKSB7XG4gICAgICAgIHRoaXMucXVhcmFudGluZSA9IHF1YXJhbnRpbmU7XG4gICAgfVxuXG4gICAgYWRkUmVxdWVzdEhvb2sgKGhvb2spIHtcbiAgICAgICAgaWYgKHRoaXMucmVxdWVzdEhvb2tzLmluZGV4T2YoaG9vaykgIT09IC0xKVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgIHRoaXMucmVxdWVzdEhvb2tzLnB1c2goaG9vayk7XG4gICAgICAgIHRoaXMuX2luaXRSZXF1ZXN0SG9vayhob29rKTtcbiAgICB9XG5cbiAgICByZW1vdmVSZXF1ZXN0SG9vayAoaG9vaykge1xuICAgICAgICBpZiAodGhpcy5yZXF1ZXN0SG9va3MuaW5kZXhPZihob29rKSA9PT0gLTEpXG4gICAgICAgICAgICByZXR1cm47XG5cbiAgICAgICAgcHVsbCh0aGlzLnJlcXVlc3RIb29rcywgaG9vayk7XG4gICAgICAgIHRoaXMuX2Rpc3Bvc2VSZXF1ZXN0SG9vayhob29rKTtcbiAgICB9XG5cbiAgICBfaW5pdFJlcXVlc3RIb29rIChob29rKSB7XG4gICAgICAgIGhvb2sud2FybmluZ0xvZyA9IHRoaXMud2FybmluZ0xvZztcblxuICAgICAgICBob29rLl9pbnN0YW50aWF0ZVJlcXVlc3RGaWx0ZXJSdWxlcygpO1xuICAgICAgICBob29rLl9pbnN0YW50aWF0ZWRSZXF1ZXN0RmlsdGVyUnVsZXMuZm9yRWFjaChydWxlID0+IHtcbiAgICAgICAgICAgIHRoaXMuc2Vzc2lvbi5hZGRSZXF1ZXN0RXZlbnRMaXN0ZW5lcnMocnVsZSwge1xuICAgICAgICAgICAgICAgIG9uUmVxdWVzdDogICAgICAgICAgIGhvb2sub25SZXF1ZXN0LmJpbmQoaG9vayksXG4gICAgICAgICAgICAgICAgb25Db25maWd1cmVSZXNwb25zZTogaG9vay5fb25Db25maWd1cmVSZXNwb25zZS5iaW5kKGhvb2spLFxuICAgICAgICAgICAgICAgIG9uUmVzcG9uc2U6ICAgICAgICAgIGhvb2sub25SZXNwb25zZS5iaW5kKGhvb2spXG4gICAgICAgICAgICB9LCBlcnIgPT4gdGhpcy5fb25SZXF1ZXN0SG9va01ldGhvZEVycm9yKGVyciwgaG9vaykpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBfb25SZXF1ZXN0SG9va01ldGhvZEVycm9yIChldmVudCwgaG9vaykge1xuICAgICAgICBsZXQgZXJyICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA9IGV2ZW50LmVycm9yO1xuICAgICAgICBjb25zdCBpc1JlcXVlc3RIb29rTm90SW1wbGVtZW50ZWRNZXRob2RFcnJvciA9IGVyciBpbnN0YW5jZW9mIFJlcXVlc3RIb29rTm90SW1wbGVtZW50ZWRNZXRob2RFcnJvcjtcblxuICAgICAgICBpZiAoIWlzUmVxdWVzdEhvb2tOb3RJbXBsZW1lbnRlZE1ldGhvZEVycm9yKSB7XG4gICAgICAgICAgICBjb25zdCBob29rQ2xhc3NOYW1lID0gaG9vay5jb25zdHJ1Y3Rvci5uYW1lO1xuXG4gICAgICAgICAgICBlcnIgPSBuZXcgUmVxdWVzdEhvb2tVbmhhbmRsZWRFcnJvcihlcnIsIGhvb2tDbGFzc05hbWUsIGV2ZW50Lm1ldGhvZE5hbWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5hZGRFcnJvcihlcnIpO1xuICAgIH1cblxuICAgIF9kaXNwb3NlUmVxdWVzdEhvb2sgKGhvb2spIHtcbiAgICAgICAgaG9vay53YXJuaW5nTG9nID0gbnVsbDtcblxuICAgICAgICBob29rLl9pbnN0YW50aWF0ZWRSZXF1ZXN0RmlsdGVyUnVsZXMuZm9yRWFjaChydWxlID0+IHtcbiAgICAgICAgICAgIHRoaXMuc2Vzc2lvbi5yZW1vdmVSZXF1ZXN0RXZlbnRMaXN0ZW5lcnMocnVsZSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIF9pbml0UmVxdWVzdEhvb2tzICgpIHtcbiAgICAgICAgdGhpcy5yZXF1ZXN0SG9va3MgPSBBcnJheS5mcm9tKHRoaXMudGVzdC5yZXF1ZXN0SG9va3MpO1xuXG4gICAgICAgIHRoaXMucmVxdWVzdEhvb2tzLmZvckVhY2goaG9vayA9PiB0aGlzLl9pbml0UmVxdWVzdEhvb2soaG9vaykpO1xuICAgIH1cblxuICAgIC8vIEhhbW1lcmhlYWQgcGF5bG9hZFxuICAgIGFzeW5jIGdldFBheWxvYWRTY3JpcHQgKCkge1xuICAgICAgICB0aGlzLmZpbGVEb3dubG9hZGluZ0hhbmRsZWQgICAgICAgICAgICAgICA9IGZhbHNlO1xuICAgICAgICB0aGlzLnJlc29sdmVXYWl0Rm9yRmlsZURvd25sb2FkaW5nUHJvbWlzZSA9IG51bGw7XG5cbiAgICAgICAgcmV0dXJuIE11c3RhY2hlLnJlbmRlcihURVNUX1JVTl9URU1QTEFURSwge1xuICAgICAgICAgICAgdGVzdFJ1bklkOiAgICAgICAgICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkodGhpcy5zZXNzaW9uLmlkKSxcbiAgICAgICAgICAgIGJyb3dzZXJJZDogICAgICAgICAgICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHRoaXMuYnJvd3NlckNvbm5lY3Rpb24uaWQpLFxuICAgICAgICAgICAgYnJvd3NlckhlYXJ0YmVhdFJlbGF0aXZlVXJsOiAgSlNPTi5zdHJpbmdpZnkodGhpcy5icm93c2VyQ29ubmVjdGlvbi5oZWFydGJlYXRSZWxhdGl2ZVVybCksXG4gICAgICAgICAgICBicm93c2VyU3RhdHVzUmVsYXRpdmVVcmw6ICAgICBKU09OLnN0cmluZ2lmeSh0aGlzLmJyb3dzZXJDb25uZWN0aW9uLnN0YXR1c1JlbGF0aXZlVXJsKSxcbiAgICAgICAgICAgIGJyb3dzZXJTdGF0dXNEb25lUmVsYXRpdmVVcmw6IEpTT04uc3RyaW5naWZ5KHRoaXMuYnJvd3NlckNvbm5lY3Rpb24uc3RhdHVzRG9uZVJlbGF0aXZlVXJsKSxcbiAgICAgICAgICAgIGJyb3dzZXJBY3RpdmVXaW5kb3dJZFVybDogICAgIEpTT04uc3RyaW5naWZ5KHRoaXMuYnJvd3NlckNvbm5lY3Rpb24uYWN0aXZlV2luZG93SWRVcmwpLFxuICAgICAgICAgICAgdXNlckFnZW50OiAgICAgICAgICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkodGhpcy5icm93c2VyQ29ubmVjdGlvbi51c2VyQWdlbnQpLFxuICAgICAgICAgICAgdGVzdE5hbWU6ICAgICAgICAgICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkodGhpcy50ZXN0Lm5hbWUpLFxuICAgICAgICAgICAgZml4dHVyZU5hbWU6ICAgICAgICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkodGhpcy50ZXN0LmZpeHR1cmUubmFtZSksXG4gICAgICAgICAgICBzZWxlY3RvclRpbWVvdXQ6ICAgICAgICAgICAgICB0aGlzLm9wdHMuc2VsZWN0b3JUaW1lb3V0LFxuICAgICAgICAgICAgcGFnZUxvYWRUaW1lb3V0OiAgICAgICAgICAgICAgdGhpcy5wYWdlTG9hZFRpbWVvdXQsXG4gICAgICAgICAgICBjaGlsZFdpbmRvd1JlYWR5VGltZW91dDogICAgICBDSElMRF9XSU5ET1dfUkVBRFlfVElNRU9VVCxcbiAgICAgICAgICAgIHNraXBKc0Vycm9yczogICAgICAgICAgICAgICAgIHRoaXMub3B0cy5za2lwSnNFcnJvcnMsXG4gICAgICAgICAgICByZXRyeVRlc3RQYWdlczogICAgICAgICAgICAgICB0aGlzLm9wdHMucmV0cnlUZXN0UGFnZXMsXG4gICAgICAgICAgICBzcGVlZDogICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNwZWVkLFxuICAgICAgICAgICAgZGlhbG9nSGFuZGxlcjogICAgICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkodGhpcy5hY3RpdmVEaWFsb2dIYW5kbGVyKSxcbiAgICAgICAgICAgIGNhblVzZURlZmF1bHRXaW5kb3dBY3Rpb25zOiAgIEpTT04uc3RyaW5naWZ5KGF3YWl0IHRoaXMuYnJvd3NlckNvbm5lY3Rpb24uY2FuVXNlRGVmYXVsdFdpbmRvd0FjdGlvbnMoKSlcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgYXN5bmMgZ2V0SWZyYW1lUGF5bG9hZFNjcmlwdCAoKSB7XG4gICAgICAgIHJldHVybiBNdXN0YWNoZS5yZW5kZXIoSUZSQU1FX1RFU1RfUlVOX1RFTVBMQVRFLCB7XG4gICAgICAgICAgICB0ZXN0UnVuSWQ6ICAgICAgIEpTT04uc3RyaW5naWZ5KHRoaXMuc2Vzc2lvbi5pZCksXG4gICAgICAgICAgICBzZWxlY3RvclRpbWVvdXQ6IHRoaXMub3B0cy5zZWxlY3RvclRpbWVvdXQsXG4gICAgICAgICAgICBwYWdlTG9hZFRpbWVvdXQ6IHRoaXMucGFnZUxvYWRUaW1lb3V0LFxuICAgICAgICAgICAgcmV0cnlUZXN0UGFnZXM6ICAhIXRoaXMub3B0cy5yZXRyeVRlc3RQYWdlcyxcbiAgICAgICAgICAgIHNwZWVkOiAgICAgICAgICAgdGhpcy5zcGVlZCxcbiAgICAgICAgICAgIGRpYWxvZ0hhbmRsZXI6ICAgSlNPTi5zdHJpbmdpZnkodGhpcy5hY3RpdmVEaWFsb2dIYW5kbGVyKVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBIYW1tZXJoZWFkIGhhbmRsZXJzXG4gICAgZ2V0QXV0aENyZWRlbnRpYWxzICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMudGVzdC5hdXRoQ3JlZGVudGlhbHM7XG4gICAgfVxuXG4gICAgaGFuZGxlRmlsZURvd25sb2FkICgpIHtcbiAgICAgICAgaWYgKHRoaXMucmVzb2x2ZVdhaXRGb3JGaWxlRG93bmxvYWRpbmdQcm9taXNlKSB7XG4gICAgICAgICAgICB0aGlzLnJlc29sdmVXYWl0Rm9yRmlsZURvd25sb2FkaW5nUHJvbWlzZSh0cnVlKTtcbiAgICAgICAgICAgIHRoaXMucmVzb2x2ZVdhaXRGb3JGaWxlRG93bmxvYWRpbmdQcm9taXNlID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICBlbHNlXG4gICAgICAgICAgICB0aGlzLmZpbGVEb3dubG9hZGluZ0hhbmRsZWQgPSB0cnVlO1xuICAgIH1cblxuICAgIGhhbmRsZVBhZ2VFcnJvciAoY3R4LCBlcnIpIHtcbiAgICAgICAgaWYgKGN0eC5yZXEuaGVhZGVyc1tVTlNUQUJMRV9ORVRXT1JLX01PREVfSEVBREVSXSkge1xuICAgICAgICAgICAgY3R4LmNsb3NlV2l0aEVycm9yKDUwMCwgZXJyLnRvU3RyaW5nKCkpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5wZW5kaW5nUGFnZUVycm9yID0gbmV3IFBhZ2VMb2FkRXJyb3IoZXJyLCBjdHgucmVxT3B0cy51cmwpO1xuXG4gICAgICAgIGN0eC5yZWRpcmVjdChjdHgudG9Qcm94eVVybChTUEVDSUFMX0VSUk9SX1BBR0UpKTtcbiAgICB9XG5cbiAgICAvLyBUZXN0IGZ1bmN0aW9uIGV4ZWN1dGlvblxuICAgIGFzeW5jIF9leGVjdXRlVGVzdEZuIChwaGFzZSwgZm4pIHtcbiAgICAgICAgdGhpcy5waGFzZSA9IHBoYXNlO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCBmbih0aGlzKTtcbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9tYWtlU2NyZWVuc2hvdE9uRmFpbCgpO1xuXG4gICAgICAgICAgICB0aGlzLmFkZEVycm9yKGVycik7XG5cbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBmaW5hbGx5IHtcbiAgICAgICAgICAgIHRoaXMuZXJyU2NyZWVuc2hvdFBhdGggPSBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuICF0aGlzLl9hZGRQZW5kaW5nUGFnZUVycm9ySWZBbnkoKTtcbiAgICB9XG5cbiAgICBhc3luYyBfcnVuQmVmb3JlSG9vayAoKSB7XG4gICAgICAgIGlmICh0aGlzLnRlc3QuYmVmb3JlRm4pXG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5fZXhlY3V0ZVRlc3RGbihQSEFTRS5pblRlc3RCZWZvcmVIb29rLCB0aGlzLnRlc3QuYmVmb3JlRm4pO1xuXG4gICAgICAgIGlmICh0aGlzLnRlc3QuZml4dHVyZS5iZWZvcmVFYWNoRm4pXG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5fZXhlY3V0ZVRlc3RGbihQSEFTRS5pbkZpeHR1cmVCZWZvcmVFYWNoSG9vaywgdGhpcy50ZXN0LmZpeHR1cmUuYmVmb3JlRWFjaEZuKTtcblxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBhc3luYyBfcnVuQWZ0ZXJIb29rICgpIHtcbiAgICAgICAgaWYgKHRoaXMudGVzdC5hZnRlckZuKVxuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2V4ZWN1dGVUZXN0Rm4oUEhBU0UuaW5UZXN0QWZ0ZXJIb29rLCB0aGlzLnRlc3QuYWZ0ZXJGbik7XG5cbiAgICAgICAgaWYgKHRoaXMudGVzdC5maXh0dXJlLmFmdGVyRWFjaEZuKVxuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2V4ZWN1dGVUZXN0Rm4oUEhBU0UuaW5GaXh0dXJlQWZ0ZXJFYWNoSG9vaywgdGhpcy50ZXN0LmZpeHR1cmUuYWZ0ZXJFYWNoRm4pO1xuXG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIGFzeW5jIHN0YXJ0ICgpIHtcbiAgICAgICAgdGVzdFJ1blRyYWNrZXIuYWN0aXZlVGVzdFJ1bnNbdGhpcy5zZXNzaW9uLmlkXSA9IHRoaXM7XG5cbiAgICAgICAgYXdhaXQgdGhpcy5lbWl0KCdzdGFydCcpO1xuXG4gICAgICAgIGNvbnN0IG9uRGlzY29ubmVjdGVkID0gZXJyID0+IHRoaXMuX2Rpc2Nvbm5lY3QoZXJyKTtcblxuICAgICAgICB0aGlzLmJyb3dzZXJDb25uZWN0aW9uLm9uY2UoJ2Rpc2Nvbm5lY3RlZCcsIG9uRGlzY29ubmVjdGVkKTtcblxuICAgICAgICBhd2FpdCB0aGlzLm9uY2UoJ2Nvbm5lY3RlZCcpO1xuXG4gICAgICAgIGF3YWl0IHRoaXMuZW1pdCgncmVhZHknKTtcblxuICAgICAgICBpZiAoYXdhaXQgdGhpcy5fcnVuQmVmb3JlSG9vaygpKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9leGVjdXRlVGVzdEZuKFBIQVNFLmluVGVzdCwgdGhpcy50ZXN0LmZuKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuX3J1bkFmdGVySG9vaygpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMuZGlzY29ubmVjdGVkKVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgIHRoaXMuYnJvd3NlckNvbm5lY3Rpb24ucmVtb3ZlTGlzdGVuZXIoJ2Rpc2Nvbm5lY3RlZCcsIG9uRGlzY29ubmVjdGVkKTtcblxuICAgICAgICBpZiAodGhpcy5lcnJzLmxlbmd0aCAmJiB0aGlzLmRlYnVnT25GYWlsKVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5fZW5xdWV1ZVNldEJyZWFrcG9pbnRDb21tYW5kKG51bGwsIHRoaXMuZGVidWdSZXBvcnRlclBsdWdpbkhvc3QuZm9ybWF0RXJyb3IodGhpcy5lcnJzWzBdKSk7XG5cbiAgICAgICAgYXdhaXQgdGhpcy5lbWl0KCdiZWZvcmUtZG9uZScpO1xuXG4gICAgICAgIGF3YWl0IHRoaXMuZXhlY3V0ZUNvbW1hbmQobmV3IHNlcnZpY2VDb21tYW5kcy5UZXN0RG9uZUNvbW1hbmQoKSk7XG5cbiAgICAgICAgdGhpcy5fYWRkUGVuZGluZ1BhZ2VFcnJvcklmQW55KCk7XG4gICAgICAgIHRoaXMuc2Vzc2lvbi5jbGVhclJlcXVlc3RFdmVudExpc3RlbmVycygpO1xuICAgICAgICB0aGlzLm5vcm1hbGl6ZVJlcXVlc3RIb29rRXJyb3JzKCk7XG5cbiAgICAgICAgZGVsZXRlIHRlc3RSdW5UcmFja2VyLmFjdGl2ZVRlc3RSdW5zW3RoaXMuc2Vzc2lvbi5pZF07XG5cbiAgICAgICAgYXdhaXQgdGhpcy5lbWl0KCdkb25lJyk7XG4gICAgfVxuXG4gICAgLy8gRXJyb3JzXG4gICAgX2FkZFBlbmRpbmdQYWdlRXJyb3JJZkFueSAoKSB7XG4gICAgICAgIGlmICh0aGlzLnBlbmRpbmdQYWdlRXJyb3IpIHtcbiAgICAgICAgICAgIHRoaXMuYWRkRXJyb3IodGhpcy5wZW5kaW5nUGFnZUVycm9yKTtcbiAgICAgICAgICAgIHRoaXMucGVuZGluZ1BhZ2VFcnJvciA9IG51bGw7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBfY3JlYXRlRXJyb3JBZGFwdGVyIChlcnIpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBUZXN0UnVuRXJyb3JGb3JtYXR0YWJsZUFkYXB0ZXIoZXJyLCB7XG4gICAgICAgICAgICB1c2VyQWdlbnQ6ICAgICAgdGhpcy5icm93c2VyQ29ubmVjdGlvbi51c2VyQWdlbnQsXG4gICAgICAgICAgICBzY3JlZW5zaG90UGF0aDogdGhpcy5lcnJTY3JlZW5zaG90UGF0aCB8fCAnJyxcbiAgICAgICAgICAgIHRlc3RSdW5JZDogICAgICB0aGlzLmlkLFxuICAgICAgICAgICAgdGVzdFJ1blBoYXNlOiAgIHRoaXMucGhhc2VcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgYWRkRXJyb3IgKGVycikge1xuICAgICAgICBjb25zdCBlcnJMaXN0ID0gZXJyIGluc3RhbmNlb2YgVGVzdENhZmVFcnJvckxpc3QgPyBlcnIuaXRlbXMgOiBbZXJyXTtcblxuICAgICAgICBlcnJMaXN0LmZvckVhY2goaXRlbSA9PiB7XG4gICAgICAgICAgICBjb25zdCBhZGFwdGVyID0gdGhpcy5fY3JlYXRlRXJyb3JBZGFwdGVyKGl0ZW0pO1xuXG4gICAgICAgICAgICB0aGlzLmVycnMucHVzaChhZGFwdGVyKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgbm9ybWFsaXplUmVxdWVzdEhvb2tFcnJvcnMgKCkge1xuICAgICAgICBjb25zdCByZXF1ZXN0SG9va0Vycm9ycyA9IHJlbW92ZSh0aGlzLmVycnMsIGUgPT5cbiAgICAgICAgICAgIGUuY29kZSA9PT0gVEVTVF9SVU5fRVJST1JTLnJlcXVlc3RIb29rTm90SW1wbGVtZW50ZWRFcnJvciB8fFxuICAgICAgICAgICAgZS5jb2RlID09PSBURVNUX1JVTl9FUlJPUlMucmVxdWVzdEhvb2tVbmhhbmRsZWRFcnJvcik7XG5cbiAgICAgICAgaWYgKCFyZXF1ZXN0SG9va0Vycm9ycy5sZW5ndGgpXG4gICAgICAgICAgICByZXR1cm47XG5cbiAgICAgICAgY29uc3QgdW5pcVJlcXVlc3RIb29rRXJyb3JzID0gY2hhaW4ocmVxdWVzdEhvb2tFcnJvcnMpXG4gICAgICAgICAgICAudW5pcUJ5KGUgPT4gZS5ob29rQ2xhc3NOYW1lICsgZS5tZXRob2ROYW1lKVxuICAgICAgICAgICAgLnNvcnRCeShbJ2hvb2tDbGFzc05hbWUnLCAnbWV0aG9kTmFtZSddKVxuICAgICAgICAgICAgLnZhbHVlKCk7XG5cbiAgICAgICAgdGhpcy5lcnJzID0gdGhpcy5lcnJzLmNvbmNhdCh1bmlxUmVxdWVzdEhvb2tFcnJvcnMpO1xuICAgIH1cblxuICAgIC8vIFRhc2sgcXVldWVcbiAgICBfZW5xdWV1ZUNvbW1hbmQgKGNvbW1hbmQsIGNhbGxzaXRlKSB7XG4gICAgICAgIGlmICh0aGlzLnBlbmRpbmdSZXF1ZXN0KVxuICAgICAgICAgICAgdGhpcy5fcmVzb2x2ZVBlbmRpbmdSZXF1ZXN0KGNvbW1hbmQpO1xuXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShhc3luYyAocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgICB0aGlzLmFkZGluZ0RyaXZlclRhc2tzQ291bnQtLTtcbiAgICAgICAgICAgIHRoaXMuZHJpdmVyVGFza1F1ZXVlLnB1c2goeyBjb21tYW5kLCByZXNvbHZlLCByZWplY3QsIGNhbGxzaXRlIH0pO1xuXG4gICAgICAgICAgICBpZiAoIXRoaXMuYWRkaW5nRHJpdmVyVGFza3NDb3VudClcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmVtaXQoQUxMX0RSSVZFUl9UQVNLU19BRERFRF9UT19RVUVVRV9FVkVOVCwgdGhpcy5kcml2ZXJUYXNrUXVldWUubGVuZ3RoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZ2V0IGRyaXZlclRhc2tRdWV1ZUxlbmd0aCAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmFkZGluZ0RyaXZlclRhc2tzQ291bnQgPyBwcm9taXNpZnlFdmVudCh0aGlzLCBBTExfRFJJVkVSX1RBU0tTX0FEREVEX1RPX1FVRVVFX0VWRU5UKSA6IFByb21pc2UucmVzb2x2ZSh0aGlzLmRyaXZlclRhc2tRdWV1ZS5sZW5ndGgpO1xuICAgIH1cblxuICAgIGFzeW5jIF9lbnF1ZXVlQnJvd3NlckNvbnNvbGVNZXNzYWdlc0NvbW1hbmQgKGNvbW1hbmQsIGNhbGxzaXRlKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2VucXVldWVDb21tYW5kKGNvbW1hbmQsIGNhbGxzaXRlKTtcblxuICAgICAgICBjb25zdCBjb25zb2xlTWVzc2FnZUNvcHkgPSB0aGlzLmNvbnNvbGVNZXNzYWdlcy5nZXRDb3B5KCk7XG5cbiAgICAgICAgcmV0dXJuIGNvbnNvbGVNZXNzYWdlQ29weVt0aGlzLmJyb3dzZXJDb25uZWN0aW9uLmFjdGl2ZVdpbmRvd0lkXTtcbiAgICB9XG5cbiAgICBhc3luYyBfZW5xdWV1ZVNldEJyZWFrcG9pbnRDb21tYW5kIChjYWxsc2l0ZSwgZXJyb3IpIHtcbiAgICAgICAgaWYgKHRoaXMuYnJvd3NlckNvbm5lY3Rpb24uaXNIZWFkbGVzc0Jyb3dzZXIoKSkge1xuICAgICAgICAgICAgdGhpcy53YXJuaW5nTG9nLmFkZFdhcm5pbmcoV0FSTklOR19NRVNTQUdFLmRlYnVnSW5IZWFkbGVzc0Vycm9yKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLmRlYnVnTG9nZ2VyKVxuICAgICAgICAgICAgdGhpcy5kZWJ1Z0xvZ2dlci5zaG93QnJlYWtwb2ludCh0aGlzLnNlc3Npb24uaWQsIHRoaXMuYnJvd3NlckNvbm5lY3Rpb24udXNlckFnZW50LCBjYWxsc2l0ZSwgZXJyb3IpO1xuXG4gICAgICAgIHRoaXMuZGVidWdnaW5nID0gYXdhaXQgdGhpcy5leGVjdXRlQ29tbWFuZChuZXcgc2VydmljZUNvbW1hbmRzLlNldEJyZWFrcG9pbnRDb21tYW5kKCEhZXJyb3IpLCBjYWxsc2l0ZSk7XG4gICAgfVxuXG4gICAgX3JlbW92ZUFsbE5vblNlcnZpY2VUYXNrcyAoKSB7XG4gICAgICAgIHRoaXMuZHJpdmVyVGFza1F1ZXVlID0gdGhpcy5kcml2ZXJUYXNrUXVldWUuZmlsdGVyKGRyaXZlclRhc2sgPT4gaXNTZXJ2aWNlQ29tbWFuZChkcml2ZXJUYXNrLmNvbW1hbmQpKTtcblxuICAgICAgICB0aGlzLmJyb3dzZXJNYW5pcHVsYXRpb25RdWV1ZS5yZW1vdmVBbGxOb25TZXJ2aWNlTWFuaXB1bGF0aW9ucygpO1xuICAgIH1cblxuICAgIC8vIEN1cnJlbnQgZHJpdmVyIHRhc2tcbiAgICBnZXQgY3VycmVudERyaXZlclRhc2sgKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5kcml2ZXJUYXNrUXVldWVbMF07XG4gICAgfVxuXG4gICAgX3Jlc29sdmVDdXJyZW50RHJpdmVyVGFzayAocmVzdWx0KSB7XG4gICAgICAgIHRoaXMuY3VycmVudERyaXZlclRhc2sucmVzb2x2ZShyZXN1bHQpO1xuICAgICAgICB0aGlzLmRyaXZlclRhc2tRdWV1ZS5zaGlmdCgpO1xuXG4gICAgICAgIGlmICh0aGlzLnRlc3REb25lQ29tbWFuZFF1ZXVlZClcbiAgICAgICAgICAgIHRoaXMuX3JlbW92ZUFsbE5vblNlcnZpY2VUYXNrcygpO1xuICAgIH1cblxuICAgIF9yZWplY3RDdXJyZW50RHJpdmVyVGFzayAoZXJyKSB7XG4gICAgICAgIGVyci5jYWxsc2l0ZSA9IGVyci5jYWxsc2l0ZSB8fCB0aGlzLmN1cnJlbnREcml2ZXJUYXNrLmNhbGxzaXRlO1xuXG4gICAgICAgIHRoaXMuY3VycmVudERyaXZlclRhc2sucmVqZWN0KGVycik7XG4gICAgICAgIHRoaXMuX3JlbW92ZUFsbE5vblNlcnZpY2VUYXNrcygpO1xuICAgIH1cblxuICAgIC8vIFBlbmRpbmcgcmVxdWVzdFxuICAgIF9jbGVhclBlbmRpbmdSZXF1ZXN0ICgpIHtcbiAgICAgICAgaWYgKHRoaXMucGVuZGluZ1JlcXVlc3QpIHtcbiAgICAgICAgICAgIGNsZWFyVGltZW91dCh0aGlzLnBlbmRpbmdSZXF1ZXN0LnJlc3BvbnNlVGltZW91dCk7XG4gICAgICAgICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0ID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIF9yZXNvbHZlUGVuZGluZ1JlcXVlc3QgKGNvbW1hbmQpIHtcbiAgICAgICAgdGhpcy5sYXN0RHJpdmVyU3RhdHVzUmVzcG9uc2UgPSBjb21tYW5kO1xuICAgICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0LnJlc29sdmUoY29tbWFuZCk7XG4gICAgICAgIHRoaXMuX2NsZWFyUGVuZGluZ1JlcXVlc3QoKTtcbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgZHJpdmVyIHJlcXVlc3RcbiAgICBfc2hvdWxkUmVzb2x2ZUN1cnJlbnREcml2ZXJUYXNrIChkcml2ZXJTdGF0dXMpIHtcbiAgICAgICAgY29uc3QgY3VycmVudENvbW1hbmQgPSB0aGlzLmN1cnJlbnREcml2ZXJUYXNrLmNvbW1hbmQ7XG5cbiAgICAgICAgY29uc3QgaXNFeGVjdXRpbmdPYnNlcnZhdGlvbkNvbW1hbmQgPSBjdXJyZW50Q29tbWFuZCBpbnN0YW5jZW9mIG9ic2VydmF0aW9uQ29tbWFuZHMuRXhlY3V0ZVNlbGVjdG9yQ29tbWFuZCB8fFxuICAgICAgICAgICAgY3VycmVudENvbW1hbmQgaW5zdGFuY2VvZiBvYnNlcnZhdGlvbkNvbW1hbmRzLkV4ZWN1dGVDbGllbnRGdW5jdGlvbkNvbW1hbmQ7XG5cbiAgICAgICAgY29uc3QgaXNEZWJ1Z0FjdGl2ZSA9IGN1cnJlbnRDb21tYW5kIGluc3RhbmNlb2Ygc2VydmljZUNvbW1hbmRzLlNldEJyZWFrcG9pbnRDb21tYW5kO1xuXG4gICAgICAgIGNvbnN0IHNob3VsZEV4ZWN1dGVDdXJyZW50Q29tbWFuZCA9XG4gICAgICAgICAgICBkcml2ZXJTdGF0dXMuaXNGaXJzdFJlcXVlc3RBZnRlcldpbmRvd1N3aXRjaGluZyAmJiAoaXNFeGVjdXRpbmdPYnNlcnZhdGlvbkNvbW1hbmQgfHwgaXNEZWJ1Z0FjdGl2ZSk7XG5cbiAgICAgICAgcmV0dXJuICFzaG91bGRFeGVjdXRlQ3VycmVudENvbW1hbmQ7XG4gICAgfVxuXG4gICAgX2Z1bGZpbGxDdXJyZW50RHJpdmVyVGFzayAoZHJpdmVyU3RhdHVzKSB7XG4gICAgICAgIGlmICghdGhpcy5jdXJyZW50RHJpdmVyVGFzaylcbiAgICAgICAgICAgIHJldHVybjtcblxuICAgICAgICBpZiAoZHJpdmVyU3RhdHVzLmV4ZWN1dGlvbkVycm9yKVxuICAgICAgICAgICAgdGhpcy5fcmVqZWN0Q3VycmVudERyaXZlclRhc2soZHJpdmVyU3RhdHVzLmV4ZWN1dGlvbkVycm9yKTtcbiAgICAgICAgZWxzZSBpZiAodGhpcy5fc2hvdWxkUmVzb2x2ZUN1cnJlbnREcml2ZXJUYXNrKGRyaXZlclN0YXR1cykpXG4gICAgICAgICAgICB0aGlzLl9yZXNvbHZlQ3VycmVudERyaXZlclRhc2soZHJpdmVyU3RhdHVzLnJlc3VsdCk7XG4gICAgfVxuXG4gICAgX2hhbmRsZVBhZ2VFcnJvclN0YXR1cyAocGFnZUVycm9yKSB7XG4gICAgICAgIGlmICh0aGlzLmN1cnJlbnREcml2ZXJUYXNrICYmIGlzQ29tbWFuZFJlamVjdGFibGVCeVBhZ2VFcnJvcih0aGlzLmN1cnJlbnREcml2ZXJUYXNrLmNvbW1hbmQpKSB7XG4gICAgICAgICAgICB0aGlzLl9yZWplY3RDdXJyZW50RHJpdmVyVGFzayhwYWdlRXJyb3IpO1xuICAgICAgICAgICAgdGhpcy5wZW5kaW5nUGFnZUVycm9yID0gbnVsbDtcblxuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnBlbmRpbmdQYWdlRXJyb3IgPSB0aGlzLnBlbmRpbmdQYWdlRXJyb3IgfHwgcGFnZUVycm9yO1xuXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBfaGFuZGxlRHJpdmVyUmVxdWVzdCAoZHJpdmVyU3RhdHVzKSB7XG4gICAgICAgIGNvbnN0IGlzVGVzdERvbmUgICAgICAgICAgICAgICAgID0gdGhpcy5jdXJyZW50RHJpdmVyVGFzayAmJiB0aGlzLmN1cnJlbnREcml2ZXJUYXNrLmNvbW1hbmQudHlwZSA9PT1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBDT01NQU5EX1RZUEUudGVzdERvbmU7XG4gICAgICAgIGNvbnN0IHBhZ2VFcnJvciAgICAgICAgICAgICAgICAgID0gdGhpcy5wZW5kaW5nUGFnZUVycm9yIHx8IGRyaXZlclN0YXR1cy5wYWdlRXJyb3I7XG4gICAgICAgIGNvbnN0IGN1cnJlbnRUYXNrUmVqZWN0ZWRCeUVycm9yID0gcGFnZUVycm9yICYmIHRoaXMuX2hhbmRsZVBhZ2VFcnJvclN0YXR1cyhwYWdlRXJyb3IpO1xuXG4gICAgICAgIGlmICh0aGlzLmRpc2Nvbm5lY3RlZClcbiAgICAgICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgoXywgcmVqZWN0KSA9PiByZWplY3QoKSk7XG5cbiAgICAgICAgdGhpcy5jb25zb2xlTWVzc2FnZXMuY29uY2F0KGRyaXZlclN0YXR1cy5jb25zb2xlTWVzc2FnZXMpO1xuXG4gICAgICAgIGlmICghY3VycmVudFRhc2tSZWplY3RlZEJ5RXJyb3IgJiYgZHJpdmVyU3RhdHVzLmlzQ29tbWFuZFJlc3VsdCkge1xuICAgICAgICAgICAgaWYgKGlzVGVzdERvbmUpIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9yZXNvbHZlQ3VycmVudERyaXZlclRhc2soKTtcblxuICAgICAgICAgICAgICAgIHJldHVybiBURVNUX0RPTkVfQ09ORklSTUFUSU9OX1JFU1BPTlNFO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLl9mdWxmaWxsQ3VycmVudERyaXZlclRhc2soZHJpdmVyU3RhdHVzKTtcblxuICAgICAgICAgICAgaWYgKGRyaXZlclN0YXR1cy5pc1BlbmRpbmdXaW5kb3dTd2l0Y2hpbmcpXG4gICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5fZ2V0Q3VycmVudERyaXZlclRhc2tDb21tYW5kKCk7XG4gICAgfVxuXG4gICAgX2dldEN1cnJlbnREcml2ZXJUYXNrQ29tbWFuZCAoKSB7XG4gICAgICAgIGlmICghdGhpcy5jdXJyZW50RHJpdmVyVGFzaylcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuXG4gICAgICAgIGNvbnN0IGNvbW1hbmQgPSB0aGlzLmN1cnJlbnREcml2ZXJUYXNrLmNvbW1hbmQ7XG5cbiAgICAgICAgaWYgKGNvbW1hbmQudHlwZSA9PT0gQ09NTUFORF9UWVBFLm5hdmlnYXRlVG8gJiYgY29tbWFuZC5zdGF0ZVNuYXBzaG90KVxuICAgICAgICAgICAgdGhpcy5zZXNzaW9uLnVzZVN0YXRlU25hcHNob3QoSlNPTi5wYXJzZShjb21tYW5kLnN0YXRlU25hcHNob3QpKTtcblxuICAgICAgICByZXR1cm4gY29tbWFuZDtcbiAgICB9XG5cbiAgICAvLyBFeGVjdXRlIGNvbW1hbmRcbiAgICBfZXhlY3V0ZUpzRXhwcmVzc2lvbiAoY29tbWFuZCkge1xuICAgICAgICBjb25zdCByZXN1bHRWYXJpYWJsZU5hbWUgPSBjb21tYW5kLnJlc3VsdFZhcmlhYmxlTmFtZTtcbiAgICAgICAgbGV0IGV4cHJlc3Npb24gICAgICAgICAgID0gY29tbWFuZC5leHByZXNzaW9uO1xuXG4gICAgICAgIGlmIChyZXN1bHRWYXJpYWJsZU5hbWUpXG4gICAgICAgICAgICBleHByZXNzaW9uID0gYCR7cmVzdWx0VmFyaWFibGVOYW1lfSA9ICR7ZXhwcmVzc2lvbn0sICR7cmVzdWx0VmFyaWFibGVOYW1lfWA7XG5cbiAgICAgICAgcmV0dXJuIGV4ZWN1dGVKc0V4cHJlc3Npb24oZXhwcmVzc2lvbiwgdGhpcywgeyBza2lwVmlzaWJpbGl0eUNoZWNrOiBmYWxzZSB9KTtcbiAgICB9XG5cbiAgICBhc3luYyBfZXhlY3V0ZUFzc2VydGlvbiAoY29tbWFuZCwgY2FsbHNpdGUpIHtcbiAgICAgICAgY29uc3QgYXNzZXJ0aW9uVGltZW91dCA9IGNvbW1hbmQub3B0aW9ucy50aW1lb3V0ID09PVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdm9pZCAwID8gdGhpcy5vcHRzLmFzc2VydGlvblRpbWVvdXQgOiBjb21tYW5kLm9wdGlvbnMudGltZW91dDtcbiAgICAgICAgY29uc3QgZXhlY3V0b3IgICAgICAgICA9IG5ldyBBc3NlcnRpb25FeGVjdXRvcihjb21tYW5kLCBhc3NlcnRpb25UaW1lb3V0LCBjYWxsc2l0ZSk7XG5cbiAgICAgICAgZXhlY3V0b3Iub25jZSgnc3RhcnQtYXNzZXJ0aW9uLXJldHJpZXMnLCB0aW1lb3V0ID0+IHRoaXMuZXhlY3V0ZUNvbW1hbmQobmV3IHNlcnZpY2VDb21tYW5kcy5TaG93QXNzZXJ0aW9uUmV0cmllc1N0YXR1c0NvbW1hbmQodGltZW91dCkpKTtcbiAgICAgICAgZXhlY3V0b3Iub25jZSgnZW5kLWFzc2VydGlvbi1yZXRyaWVzJywgc3VjY2VzcyA9PiB0aGlzLmV4ZWN1dGVDb21tYW5kKG5ldyBzZXJ2aWNlQ29tbWFuZHMuSGlkZUFzc2VydGlvblJldHJpZXNTdGF0dXNDb21tYW5kKHN1Y2Nlc3MpKSk7XG5cbiAgICAgICAgY29uc3QgZXhlY3V0ZUZuID0gdGhpcy5kZWNvcmF0ZVByZXZlbnRFbWl0QWN0aW9uRXZlbnRzKCgpID0+IGV4ZWN1dG9yLnJ1bigpLCB7IHByZXZlbnQ6IHRydWUgfSk7XG5cbiAgICAgICAgcmV0dXJuIGF3YWl0IGV4ZWN1dGVGbigpO1xuICAgIH1cblxuICAgIF9hZGp1c3RDb25maWd1cmF0aW9uV2l0aENvbW1hbmQgKGNvbW1hbmQpIHtcbiAgICAgICAgaWYgKGNvbW1hbmQudHlwZSA9PT0gQ09NTUFORF9UWVBFLnRlc3REb25lKSB7XG4gICAgICAgICAgICB0aGlzLnRlc3REb25lQ29tbWFuZFF1ZXVlZCA9IHRydWU7XG4gICAgICAgICAgICBpZiAodGhpcy5kZWJ1Z0xvZ2dlcilcbiAgICAgICAgICAgICAgICB0aGlzLmRlYnVnTG9nZ2VyLmhpZGVCcmVha3BvaW50KHRoaXMuc2Vzc2lvbi5pZCk7XG4gICAgICAgIH1cblxuICAgICAgICBlbHNlIGlmIChjb21tYW5kLnR5cGUgPT09IENPTU1BTkRfVFlQRS5zZXROYXRpdmVEaWFsb2dIYW5kbGVyKVxuICAgICAgICAgICAgdGhpcy5hY3RpdmVEaWFsb2dIYW5kbGVyID0gY29tbWFuZC5kaWFsb2dIYW5kbGVyO1xuXG4gICAgICAgIGVsc2UgaWYgKGNvbW1hbmQudHlwZSA9PT0gQ09NTUFORF9UWVBFLnN3aXRjaFRvSWZyYW1lKVxuICAgICAgICAgICAgdGhpcy5hY3RpdmVJZnJhbWVTZWxlY3RvciA9IGNvbW1hbmQuc2VsZWN0b3I7XG5cbiAgICAgICAgZWxzZSBpZiAoY29tbWFuZC50eXBlID09PSBDT01NQU5EX1RZUEUuc3dpdGNoVG9NYWluV2luZG93KVxuICAgICAgICAgICAgdGhpcy5hY3RpdmVJZnJhbWVTZWxlY3RvciA9IG51bGw7XG5cbiAgICAgICAgZWxzZSBpZiAoY29tbWFuZC50eXBlID09PSBDT01NQU5EX1RZUEUuc2V0VGVzdFNwZWVkKVxuICAgICAgICAgICAgdGhpcy5zcGVlZCA9IGNvbW1hbmQuc3BlZWQ7XG5cbiAgICAgICAgZWxzZSBpZiAoY29tbWFuZC50eXBlID09PSBDT01NQU5EX1RZUEUuc2V0UGFnZUxvYWRUaW1lb3V0KVxuICAgICAgICAgICAgdGhpcy5wYWdlTG9hZFRpbWVvdXQgPSBjb21tYW5kLmR1cmF0aW9uO1xuXG4gICAgICAgIGVsc2UgaWYgKGNvbW1hbmQudHlwZSA9PT0gQ09NTUFORF9UWVBFLmRlYnVnKVxuICAgICAgICAgICAgdGhpcy5kZWJ1Z2dpbmcgPSB0cnVlO1xuICAgIH1cblxuICAgIGFzeW5jIF9hZGp1c3RTY3JlZW5zaG90Q29tbWFuZCAoY29tbWFuZCkge1xuICAgICAgICBjb25zdCBicm93c2VySWQgICAgICAgICAgICAgICAgICAgID0gdGhpcy5icm93c2VyQ29ubmVjdGlvbi5pZDtcbiAgICAgICAgY29uc3QgeyBoYXNDaHJvbWVsZXNzU2NyZWVuc2hvdHMgfSA9IGF3YWl0IHRoaXMuYnJvd3NlckNvbm5lY3Rpb24ucHJvdmlkZXIuaGFzQ3VzdG9tQWN0aW9uRm9yQnJvd3Nlcihicm93c2VySWQpO1xuXG4gICAgICAgIGlmICghaGFzQ2hyb21lbGVzc1NjcmVlbnNob3RzKVxuICAgICAgICAgICAgY29tbWFuZC5nZW5lcmF0ZVNjcmVlbnNob3RNYXJrKCk7XG4gICAgfVxuXG4gICAgYXN5bmMgX3NldEJyZWFrcG9pbnRJZk5lY2Vzc2FyeSAoY29tbWFuZCwgY2FsbHNpdGUpIHtcbiAgICAgICAgaWYgKCF0aGlzLmRpc2FibGVEZWJ1Z0JyZWFrcG9pbnRzICYmIHRoaXMuZGVidWdnaW5nICYmIGNhblNldERlYnVnZ2VyQnJlYWtwb2ludEJlZm9yZUNvbW1hbmQoY29tbWFuZCkpXG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9lbnF1ZXVlU2V0QnJlYWtwb2ludENvbW1hbmQoY2FsbHNpdGUpO1xuICAgIH1cblxuICAgIGFzeW5jIGV4ZWN1dGVBY3Rpb24gKGFwaUFjdGlvbk5hbWUsIGNvbW1hbmQsIGNhbGxzaXRlKSB7XG4gICAgICAgIGNvbnN0IGFjdGlvbkFyZ3MgPSB7IGFwaUFjdGlvbk5hbWUsIGNvbW1hbmQgfTtcblxuICAgICAgICBsZXQgZXJyb3JBZGFwdGVyID0gbnVsbDtcbiAgICAgICAgbGV0IGVycm9yICAgICAgICA9IG51bGw7XG4gICAgICAgIGxldCByZXN1bHQgICAgICAgPSBudWxsO1xuXG4gICAgICAgIGF3YWl0IHRoaXMuZW1pdEFjdGlvbkV2ZW50KCdhY3Rpb24tc3RhcnQnLCBhY3Rpb25BcmdzKTtcblxuICAgICAgICBjb25zdCBzdGFydCA9IG5ldyBEYXRlKCk7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMuZXhlY3V0ZUNvbW1hbmQoY29tbWFuZCwgY2FsbHNpdGUpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgIGVycm9yID0gZXJyO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZHVyYXRpb24gPSBuZXcgRGF0ZSgpIC0gc3RhcnQ7XG5cbiAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgICAvLyBOT1RFOiBjaGVjayBpZiBlcnJvciBpcyBUZXN0Q2FmZUVycm9yTGlzdCBpcyBzcGVjaWZpYyBmb3IgdGhlIGB1c2VSb2xlYCBhY3Rpb25cbiAgICAgICAgICAgIC8vIGlmIGVycm9yIGlzIFRlc3RDYWZlRXJyb3JMaXN0IHdlIGRvIG5vdCBuZWVkIHRvIGNyZWF0ZSBhbiBhZGFwdGVyLFxuICAgICAgICAgICAgLy8gc2luY2UgZXJyb3IgaXMgYWxyZWFkeSB3YXMgcHJvY2Vzc2VkIGluIHJvbGUgaW5pdGlhbGl6ZXJcbiAgICAgICAgICAgIGlmICghKGVycm9yIGluc3RhbmNlb2YgVGVzdENhZmVFcnJvckxpc3QpKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5fbWFrZVNjcmVlbnNob3RPbkZhaWwoKTtcblxuICAgICAgICAgICAgICAgIGVycm9yQWRhcHRlciA9IHRoaXMuX2NyZWF0ZUVycm9yQWRhcHRlcihwcm9jZXNzVGVzdEZuRXJyb3IoZXJyb3IpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIE9iamVjdC5hc3NpZ24oYWN0aW9uQXJncywge1xuICAgICAgICAgICAgcmVzdWx0LFxuICAgICAgICAgICAgZHVyYXRpb24sXG4gICAgICAgICAgICBlcnI6IGVycm9yQWRhcHRlclxuICAgICAgICB9KTtcblxuICAgICAgICBhd2FpdCB0aGlzLmVtaXRBY3Rpb25FdmVudCgnYWN0aW9uLWRvbmUnLCBhY3Rpb25BcmdzKTtcblxuICAgICAgICBpZiAoZXJyb3IpXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcblxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIGFzeW5jIGV4ZWN1dGVDb21tYW5kIChjb21tYW5kLCBjYWxsc2l0ZSkge1xuICAgICAgICB0aGlzLmRlYnVnTG9nLmNvbW1hbmQoY29tbWFuZCk7XG5cbiAgICAgICAgaWYgKHRoaXMucGVuZGluZ1BhZ2VFcnJvciAmJiBpc0NvbW1hbmRSZWplY3RhYmxlQnlQYWdlRXJyb3IoY29tbWFuZCkpXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fcmVqZWN0Q29tbWFuZFdpdGhQYWdlRXJyb3IoY2FsbHNpdGUpO1xuXG4gICAgICAgIGlmIChpc0V4ZWN1dGFibGVPbkNsaWVudENvbW1hbmQoY29tbWFuZCkpXG4gICAgICAgICAgICB0aGlzLmFkZGluZ0RyaXZlclRhc2tzQ291bnQrKztcblxuICAgICAgICB0aGlzLl9hZGp1c3RDb25maWd1cmF0aW9uV2l0aENvbW1hbmQoY29tbWFuZCk7XG5cbiAgICAgICAgYXdhaXQgdGhpcy5fc2V0QnJlYWtwb2ludElmTmVjZXNzYXJ5KGNvbW1hbmQsIGNhbGxzaXRlKTtcblxuICAgICAgICBpZiAoaXNTY3JlZW5zaG90Q29tbWFuZChjb21tYW5kKSkge1xuICAgICAgICAgICAgaWYgKHRoaXMub3B0cy5kaXNhYmxlU2NyZWVuc2hvdHMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLndhcm5pbmdMb2cuYWRkV2FybmluZyhXQVJOSU5HX01FU1NBR0Uuc2NyZWVuc2hvdHNEaXNhYmxlZCk7XG5cbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgYXdhaXQgdGhpcy5fYWRqdXN0U2NyZWVuc2hvdENvbW1hbmQoY29tbWFuZCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNCcm93c2VyTWFuaXB1bGF0aW9uQ29tbWFuZChjb21tYW5kKSkge1xuICAgICAgICAgICAgdGhpcy5icm93c2VyTWFuaXB1bGF0aW9uUXVldWUucHVzaChjb21tYW5kKTtcblxuICAgICAgICAgICAgaWYgKGlzUmVzaXplV2luZG93Q29tbWFuZChjb21tYW5kKSAmJiB0aGlzLm9wdHMudmlkZW9QYXRoKVxuICAgICAgICAgICAgICAgIHRoaXMud2FybmluZ0xvZy5hZGRXYXJuaW5nKFdBUk5JTkdfTUVTU0FHRS52aWRlb0Jyb3dzZXJSZXNpemluZywgdGhpcy50ZXN0Lm5hbWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNvbW1hbmQudHlwZSA9PT0gQ09NTUFORF9UWVBFLndhaXQpXG4gICAgICAgICAgICByZXR1cm4gZGVsYXkoY29tbWFuZC50aW1lb3V0KTtcblxuICAgICAgICBpZiAoY29tbWFuZC50eXBlID09PSBDT01NQU5EX1RZUEUuc2V0UGFnZUxvYWRUaW1lb3V0KVxuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICAgICAgaWYgKGNvbW1hbmQudHlwZSA9PT0gQ09NTUFORF9UWVBFLmRlYnVnKVxuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2VucXVldWVTZXRCcmVha3BvaW50Q29tbWFuZChjYWxsc2l0ZSk7XG5cbiAgICAgICAgaWYgKGNvbW1hbmQudHlwZSA9PT0gQ09NTUFORF9UWVBFLnVzZVJvbGUpIHtcbiAgICAgICAgICAgIGxldCBmbiA9ICgpID0+IHRoaXMuX3VzZVJvbGUoY29tbWFuZC5yb2xlLCBjYWxsc2l0ZSk7XG5cbiAgICAgICAgICAgIGZuID0gdGhpcy5kZWNvcmF0ZVByZXZlbnRFbWl0QWN0aW9uRXZlbnRzKGZuLCB7IHByZXZlbnQ6IHRydWUgfSk7XG4gICAgICAgICAgICBmbiA9IHRoaXMuZGVjb3JhdGVEaXNhYmxlRGVidWdCcmVha3BvaW50cyhmbiwgeyBkaXNhYmxlOiB0cnVlIH0pO1xuXG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgZm4oKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChjb21tYW5kLnR5cGUgPT09IENPTU1BTkRfVFlQRS5hc3NlcnRpb24pXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fZXhlY3V0ZUFzc2VydGlvbihjb21tYW5kLCBjYWxsc2l0ZSk7XG5cbiAgICAgICAgaWYgKGNvbW1hbmQudHlwZSA9PT0gQ09NTUFORF9UWVBFLmV4ZWN1dGVFeHByZXNzaW9uKVxuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2V4ZWN1dGVKc0V4cHJlc3Npb24oY29tbWFuZCwgY2FsbHNpdGUpO1xuXG4gICAgICAgIGlmIChjb21tYW5kLnR5cGUgPT09IENPTU1BTkRfVFlQRS5leGVjdXRlQXN5bmNFeHByZXNzaW9uKVxuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IGV4ZWN1dGVBc3luY0pzRXhwcmVzc2lvbihjb21tYW5kLmV4cHJlc3Npb24sIHRoaXMsIGNhbGxzaXRlKTtcblxuICAgICAgICBpZiAoY29tbWFuZC50eXBlID09PSBDT01NQU5EX1RZUEUuZ2V0QnJvd3NlckNvbnNvbGVNZXNzYWdlcylcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9lbnF1ZXVlQnJvd3NlckNvbnNvbGVNZXNzYWdlc0NvbW1hbmQoY29tbWFuZCwgY2FsbHNpdGUpO1xuXG4gICAgICAgIGlmIChjb21tYW5kLnR5cGUgPT09IENPTU1BTkRfVFlQRS5zd2l0Y2hUb1ByZXZpb3VzV2luZG93KVxuICAgICAgICAgICAgY29tbWFuZC53aW5kb3dJZCA9IHRoaXMuYnJvd3NlckNvbm5lY3Rpb24ucHJldmlvdXNBY3RpdmVXaW5kb3dJZDtcblxuICAgICAgICBpZiAoY29tbWFuZC50eXBlID09PSBDT01NQU5EX1RZUEUuc3dpdGNoVG9XaW5kb3dCeVByZWRpY2F0ZSlcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9zd2l0Y2hUb1dpbmRvd0J5UHJlZGljYXRlKGNvbW1hbmQpO1xuXG5cbiAgICAgICAgcmV0dXJuIHRoaXMuX2VucXVldWVDb21tYW5kKGNvbW1hbmQsIGNhbGxzaXRlKTtcbiAgICB9XG5cbiAgICBfcmVqZWN0Q29tbWFuZFdpdGhQYWdlRXJyb3IgKGNhbGxzaXRlKSB7XG4gICAgICAgIGNvbnN0IGVyciA9IHRoaXMucGVuZGluZ1BhZ2VFcnJvcjtcblxuICAgICAgICBlcnIuY2FsbHNpdGUgICAgICAgICAgPSBjYWxsc2l0ZTtcbiAgICAgICAgdGhpcy5wZW5kaW5nUGFnZUVycm9yID0gbnVsbDtcblxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QoZXJyKTtcbiAgICB9XG5cbiAgICBhc3luYyBfbWFrZVNjcmVlbnNob3RPbkZhaWwgKCkge1xuICAgICAgICBjb25zdCB7IHNjcmVlbnNob3RzIH0gPSB0aGlzLm9wdHM7XG5cbiAgICAgICAgaWYgKCF0aGlzLmVyclNjcmVlbnNob3RQYXRoICYmIHNjcmVlbnNob3RzICYmIHNjcmVlbnNob3RzLnRha2VPbkZhaWxzKVxuICAgICAgICAgICAgdGhpcy5lcnJTY3JlZW5zaG90UGF0aCA9IGF3YWl0IHRoaXMuZXhlY3V0ZUNvbW1hbmQobmV3IGJyb3dzZXJNYW5pcHVsYXRpb25Db21tYW5kcy5UYWtlU2NyZWVuc2hvdE9uRmFpbENvbW1hbmQoKSk7XG4gICAgfVxuXG4gICAgX2RlY29yYXRlV2l0aEZsYWcgKGZuLCBmbGFnTmFtZSwgdmFsdWUpIHtcbiAgICAgICAgcmV0dXJuIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIHRoaXNbZmxhZ05hbWVdID0gdmFsdWU7XG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGF3YWl0IGZuKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZmluYWxseSB7XG4gICAgICAgICAgICAgICAgdGhpc1tmbGFnTmFtZV0gPSAhdmFsdWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgZGVjb3JhdGVQcmV2ZW50RW1pdEFjdGlvbkV2ZW50cyAoZm4sIHsgcHJldmVudCB9KSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9kZWNvcmF0ZVdpdGhGbGFnKGZuLCAncHJldmVudEVtaXRBY3Rpb25FdmVudHMnLCBwcmV2ZW50KTtcbiAgICB9XG5cbiAgICBkZWNvcmF0ZURpc2FibGVEZWJ1Z0JyZWFrcG9pbnRzIChmbiwgeyBkaXNhYmxlIH0pIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2RlY29yYXRlV2l0aEZsYWcoZm4sICdkaXNhYmxlRGVidWdCcmVha3BvaW50cycsIGRpc2FibGUpO1xuICAgIH1cblxuICAgIC8vIFJvbGUgbWFuYWdlbWVudFxuICAgIGFzeW5jIGdldFN0YXRlU25hcHNob3QgKCkge1xuICAgICAgICBjb25zdCBzdGF0ZSA9IHRoaXMuc2Vzc2lvbi5nZXRTdGF0ZVNuYXBzaG90KCk7XG5cbiAgICAgICAgc3RhdGUuc3RvcmFnZXMgPSBhd2FpdCB0aGlzLmV4ZWN1dGVDb21tYW5kKG5ldyBzZXJ2aWNlQ29tbWFuZHMuQmFja3VwU3RvcmFnZXNDb21tYW5kKCkpO1xuXG4gICAgICAgIHJldHVybiBzdGF0ZTtcbiAgICB9XG5cbiAgICBhc3luYyBzd2l0Y2hUb0NsZWFuUnVuICh1cmwpIHtcbiAgICAgICAgdGhpcy5jdHggICAgICAgICAgICAgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuICAgICAgICB0aGlzLmZpeHR1cmVDdHggICAgICA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG4gICAgICAgIHRoaXMuY29uc29sZU1lc3NhZ2VzID0gbmV3IEJyb3dzZXJDb25zb2xlTWVzc2FnZXMoKTtcblxuICAgICAgICB0aGlzLnNlc3Npb24udXNlU3RhdGVTbmFwc2hvdChTdGF0ZVNuYXBzaG90LmVtcHR5KCkpO1xuXG4gICAgICAgIGlmICh0aGlzLnNwZWVkICE9PSB0aGlzLm9wdHMuc3BlZWQpIHtcbiAgICAgICAgICAgIGNvbnN0IHNldFNwZWVkQ29tbWFuZCA9IG5ldyBhY3Rpb25Db21tYW5kcy5TZXRUZXN0U3BlZWRDb21tYW5kKHsgc3BlZWQ6IHRoaXMub3B0cy5zcGVlZCB9KTtcblxuICAgICAgICAgICAgYXdhaXQgdGhpcy5leGVjdXRlQ29tbWFuZChzZXRTcGVlZENvbW1hbmQpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMucGFnZUxvYWRUaW1lb3V0ICE9PSB0aGlzLm9wdHMucGFnZUxvYWRUaW1lb3V0KSB7XG4gICAgICAgICAgICBjb25zdCBzZXRQYWdlTG9hZFRpbWVvdXRDb21tYW5kID0gbmV3IGFjdGlvbkNvbW1hbmRzLlNldFBhZ2VMb2FkVGltZW91dENvbW1hbmQoeyBkdXJhdGlvbjogdGhpcy5vcHRzLnBhZ2VMb2FkVGltZW91dCB9KTtcblxuICAgICAgICAgICAgYXdhaXQgdGhpcy5leGVjdXRlQ29tbWFuZChzZXRQYWdlTG9hZFRpbWVvdXRDb21tYW5kKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHRoaXMubmF2aWdhdGVUb1VybCh1cmwsIHRydWUpO1xuXG4gICAgICAgIGlmICh0aGlzLmFjdGl2ZURpYWxvZ0hhbmRsZXIpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlbW92ZURpYWxvZ0hhbmRsZXJDb21tYW5kID0gbmV3IGFjdGlvbkNvbW1hbmRzLlNldE5hdGl2ZURpYWxvZ0hhbmRsZXJDb21tYW5kKHsgZGlhbG9nSGFuZGxlcjogeyBmbjogbnVsbCB9IH0pO1xuXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVDb21tYW5kKHJlbW92ZURpYWxvZ0hhbmRsZXJDb21tYW5kKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFzeW5jIG5hdmlnYXRlVG9VcmwgKHVybCwgZm9yY2VSZWxvYWQsIHN0YXRlU25hcHNob3QpIHtcbiAgICAgICAgY29uc3QgbmF2aWdhdGVDb21tYW5kID0gbmV3IGFjdGlvbkNvbW1hbmRzLk5hdmlnYXRlVG9Db21tYW5kKHsgdXJsLCBmb3JjZVJlbG9hZCwgc3RhdGVTbmFwc2hvdCB9KTtcblxuICAgICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVDb21tYW5kKG5hdmlnYXRlQ29tbWFuZCk7XG4gICAgfVxuXG4gICAgYXN5bmMgX2dldFN0YXRlU25hcHNob3RGcm9tUm9sZSAocm9sZSkge1xuICAgICAgICBjb25zdCBwcmV2UGhhc2UgPSB0aGlzLnBoYXNlO1xuXG4gICAgICAgIHRoaXMucGhhc2UgPSBQSEFTRS5pblJvbGVJbml0aWFsaXplcjtcblxuICAgICAgICBpZiAocm9sZS5waGFzZSA9PT0gUk9MRV9QSEFTRS51bmluaXRpYWxpemVkKVxuICAgICAgICAgICAgYXdhaXQgcm9sZS5pbml0aWFsaXplKHRoaXMpO1xuXG4gICAgICAgIGVsc2UgaWYgKHJvbGUucGhhc2UgPT09IFJPTEVfUEhBU0UucGVuZGluZ0luaXRpYWxpemF0aW9uKVxuICAgICAgICAgICAgYXdhaXQgcHJvbWlzaWZ5RXZlbnQocm9sZSwgJ2luaXRpYWxpemVkJyk7XG5cbiAgICAgICAgaWYgKHJvbGUuaW5pdEVycilcbiAgICAgICAgICAgIHRocm93IHJvbGUuaW5pdEVycjtcblxuICAgICAgICB0aGlzLnBoYXNlID0gcHJldlBoYXNlO1xuXG4gICAgICAgIHJldHVybiByb2xlLnN0YXRlU25hcHNob3Q7XG4gICAgfVxuXG4gICAgYXN5bmMgX3VzZVJvbGUgKHJvbGUsIGNhbGxzaXRlKSB7XG4gICAgICAgIGlmICh0aGlzLnBoYXNlID09PSBQSEFTRS5pblJvbGVJbml0aWFsaXplcilcbiAgICAgICAgICAgIHRocm93IG5ldyBSb2xlU3dpdGNoSW5Sb2xlSW5pdGlhbGl6ZXJFcnJvcihjYWxsc2l0ZSk7XG5cbiAgICAgICAgY29uc3QgYm9va21hcmsgPSBuZXcgVGVzdFJ1bkJvb2ttYXJrKHRoaXMsIHJvbGUpO1xuXG4gICAgICAgIGF3YWl0IGJvb2ttYXJrLmluaXQoKTtcblxuICAgICAgICBpZiAodGhpcy5jdXJyZW50Um9sZUlkKVxuICAgICAgICAgICAgdGhpcy51c2VkUm9sZVN0YXRlc1t0aGlzLmN1cnJlbnRSb2xlSWRdID0gYXdhaXQgdGhpcy5nZXRTdGF0ZVNuYXBzaG90KCk7XG5cbiAgICAgICAgY29uc3Qgc3RhdGVTbmFwc2hvdCA9IHRoaXMudXNlZFJvbGVTdGF0ZXNbcm9sZS5pZF0gfHwgYXdhaXQgdGhpcy5fZ2V0U3RhdGVTbmFwc2hvdEZyb21Sb2xlKHJvbGUpO1xuXG4gICAgICAgIHRoaXMuc2Vzc2lvbi51c2VTdGF0ZVNuYXBzaG90KHN0YXRlU25hcHNob3QpO1xuXG4gICAgICAgIHRoaXMuY3VycmVudFJvbGVJZCA9IHJvbGUuaWQ7XG5cbiAgICAgICAgYXdhaXQgYm9va21hcmsucmVzdG9yZShjYWxsc2l0ZSwgc3RhdGVTbmFwc2hvdCk7XG4gICAgfVxuXG4gICAgYXN5bmMgZ2V0Q3VycmVudFVybCAoKSB7XG4gICAgICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgQ2xpZW50RnVuY3Rpb25CdWlsZGVyKCgpID0+IHtcbiAgICAgICAgICAgIC8qIGVzbGludC1kaXNhYmxlIG5vLXVuZGVmICovXG4gICAgICAgICAgICByZXR1cm4gd2luZG93LmxvY2F0aW9uLmhyZWY7XG4gICAgICAgICAgICAvKiBlc2xpbnQtZW5hYmxlIG5vLXVuZGVmICovXG4gICAgICAgIH0sIHsgYm91bmRUZXN0UnVuOiB0aGlzIH0pO1xuXG4gICAgICAgIGNvbnN0IGdldExvY2F0aW9uID0gYnVpbGRlci5nZXRGdW5jdGlvbigpO1xuXG4gICAgICAgIHJldHVybiBhd2FpdCBnZXRMb2NhdGlvbigpO1xuICAgIH1cblxuICAgIGFzeW5jIF9zd2l0Y2hUb1dpbmRvd0J5UHJlZGljYXRlIChjb21tYW5kKSB7XG4gICAgICAgIGNvbnN0IGN1cnJlbnRXaW5kb3dzID0gYXdhaXQgdGhpcy5leGVjdXRlQ29tbWFuZChuZXcgR2V0Q3VycmVudFdpbmRvd3NDb21tYW5kKHt9LCB0aGlzKSk7XG5cbiAgICAgICAgY29uc3Qgd2luZG93cyA9IGN1cnJlbnRXaW5kb3dzLmZpbHRlcih3bmQgPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHduZC51cmwpO1xuXG4gICAgICAgICAgICAgICAgcmV0dXJuIGNvbW1hbmQuZmluZFdpbmRvdyh7IHVybCwgdGl0bGU6IHduZC50aXRsZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IFN3aXRjaFRvV2luZG93UHJlZGljYXRlRXJyb3IoZS5tZXNzYWdlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKCF3aW5kb3dzLmxlbmd0aClcbiAgICAgICAgICAgIHRocm93IG5ldyBXaW5kb3dOb3RGb3VuZEVycm9yKCk7XG5cbiAgICAgICAgaWYgKHdpbmRvd3MubGVuZ3RoID4gMSlcbiAgICAgICAgICAgIHRoaXMud2FybmluZ0xvZy5hZGRXYXJuaW5nKFdBUk5JTkdfTUVTU0FHRS5tdWx0aXBsZVdpbmRvd3NGb3VuZEJ5UHJlZGljYXRlKTtcblxuICAgICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVDb21tYW5kKG5ldyBTd2l0Y2hUb1dpbmRvd0NvbW1hbmQoeyB3aW5kb3dJZDogd2luZG93c1swXS5pZCB9KSwgdGhpcyk7XG4gICAgfVxuXG4gICAgX2Rpc2Nvbm5lY3QgKGVycikge1xuICAgICAgICB0aGlzLmRpc2Nvbm5lY3RlZCA9IHRydWU7XG5cbiAgICAgICAgaWYgKHRoaXMuY3VycmVudERyaXZlclRhc2spXG4gICAgICAgICAgICB0aGlzLl9yZWplY3RDdXJyZW50RHJpdmVyVGFzayhlcnIpO1xuXG4gICAgICAgIHRoaXMuZW1pdCgnZGlzY29ubmVjdGVkJywgZXJyKTtcblxuICAgICAgICBkZWxldGUgdGVzdFJ1blRyYWNrZXIuYWN0aXZlVGVzdFJ1bnNbdGhpcy5zZXNzaW9uLmlkXTtcbiAgICB9XG5cbiAgICBhc3luYyBlbWl0QWN0aW9uRXZlbnQgKGV2ZW50TmFtZSwgYXJncykge1xuICAgICAgICBpZiAoIXRoaXMucHJldmVudEVtaXRBY3Rpb25FdmVudHMpXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmVtaXQoZXZlbnROYW1lLCBhcmdzKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgaXNNdWx0aXBsZVdpbmRvd3NBbGxvd2VkICh0ZXN0UnVuKSB7XG4gICAgICAgIGNvbnN0IHsgZGlzYWJsZU11bHRpcGxlV2luZG93cywgdGVzdCwgYnJvd3NlckNvbm5lY3Rpb24gfSA9IHRlc3RSdW47XG5cbiAgICAgICAgcmV0dXJuICFkaXNhYmxlTXVsdGlwbGVXaW5kb3dzICYmICF0ZXN0LmlzTGVnYWN5ICYmICEhYnJvd3NlckNvbm5lY3Rpb24uYWN0aXZlV2luZG93SWQ7XG4gICAgfVxufVxuXG4vLyBTZXJ2aWNlIG1lc3NhZ2UgaGFuZGxlcnNcbmNvbnN0IFNlcnZpY2VNZXNzYWdlcyA9IFRlc3RSdW4ucHJvdG90eXBlO1xuXG4vLyBOT1RFOiB0aGlzIGZ1bmN0aW9uIGlzIHRpbWUtY3JpdGljYWwgYW5kIG11c3QgcmV0dXJuIEFTQVAgdG8gYXZvaWQgY2xpZW50IGRpc2Nvbm5lY3Rpb25cblNlcnZpY2VNZXNzYWdlc1tDTElFTlRfTUVTU0FHRVMucmVhZHldID0gZnVuY3Rpb24gKG1zZykge1xuICAgIHRoaXMuZGVidWdMb2cuZHJpdmVyTWVzc2FnZShtc2cpO1xuXG4gICAgdGhpcy5lbWl0KCdjb25uZWN0ZWQnKTtcblxuICAgIHRoaXMuX2NsZWFyUGVuZGluZ1JlcXVlc3QoKTtcblxuICAgIC8vIE5PVEU6IHRoZSBkcml2ZXIgc2VuZHMgdGhlIHN0YXR1cyBmb3IgdGhlIHNlY29uZCB0aW1lIGlmIGl0IGRpZG4ndCBnZXQgYSByZXNwb25zZSBhdCB0aGVcbiAgICAvLyBmaXJzdCB0cnkuIFRoaXMgaXMgcG9zc2libGUgd2hlbiB0aGUgcGFnZSB3YXMgdW5sb2FkZWQgYWZ0ZXIgdGhlIGRyaXZlciBzZW50IHRoZSBzdGF0dXMuXG4gICAgaWYgKG1zZy5zdGF0dXMuaWQgPT09IHRoaXMubGFzdERyaXZlclN0YXR1c0lkKVxuICAgICAgICByZXR1cm4gdGhpcy5sYXN0RHJpdmVyU3RhdHVzUmVzcG9uc2U7XG5cbiAgICB0aGlzLmxhc3REcml2ZXJTdGF0dXNJZCAgICAgICA9IG1zZy5zdGF0dXMuaWQ7XG4gICAgdGhpcy5sYXN0RHJpdmVyU3RhdHVzUmVzcG9uc2UgPSB0aGlzLl9oYW5kbGVEcml2ZXJSZXF1ZXN0KG1zZy5zdGF0dXMpO1xuXG4gICAgaWYgKHRoaXMubGFzdERyaXZlclN0YXR1c1Jlc3BvbnNlIHx8IG1zZy5zdGF0dXMuaXNQZW5kaW5nV2luZG93U3dpdGNoaW5nKVxuICAgICAgICByZXR1cm4gdGhpcy5sYXN0RHJpdmVyU3RhdHVzUmVzcG9uc2U7XG5cbiAgICAvLyBOT1RFOiB3ZSBzZW5kIGFuIGVtcHR5IHJlc3BvbnNlIGFmdGVyIHRoZSBNQVhfUkVTUE9OU0VfREVMQVkgdGltZW91dCBpcyBleGNlZWRlZCB0byBrZWVwIGNvbm5lY3Rpb25cbiAgICAvLyB3aXRoIHRoZSBjbGllbnQgYW5kIHByZXZlbnQgdGhlIHJlc3BvbnNlIHRpbWVvdXQgZXhjZXB0aW9uIG9uIHRoZSBjbGllbnQgc2lkZVxuICAgIGNvbnN0IHJlc3BvbnNlVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4gdGhpcy5fcmVzb2x2ZVBlbmRpbmdSZXF1ZXN0KG51bGwpLCBNQVhfUkVTUE9OU0VfREVMQVkpO1xuXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdCA9IHsgcmVzb2x2ZSwgcmVqZWN0LCByZXNwb25zZVRpbWVvdXQgfTtcbiAgICB9KTtcbn07XG5cblNlcnZpY2VNZXNzYWdlc1tDTElFTlRfTUVTU0FHRVMucmVhZHlGb3JCcm93c2VyTWFuaXB1bGF0aW9uXSA9IGFzeW5jIGZ1bmN0aW9uIChtc2cpIHtcbiAgICB0aGlzLmRlYnVnTG9nLmRyaXZlck1lc3NhZ2UobXNnKTtcblxuICAgIGxldCByZXN1bHQgPSBudWxsO1xuICAgIGxldCBlcnJvciAgPSBudWxsO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5icm93c2VyTWFuaXB1bGF0aW9uUXVldWUuZXhlY3V0ZVBlbmRpbmdNYW5pcHVsYXRpb24obXNnKTtcbiAgICB9XG4gICAgY2F0Y2ggKGVycikge1xuICAgICAgICBlcnJvciA9IGVycjtcbiAgICB9XG5cbiAgICByZXR1cm4geyByZXN1bHQsIGVycm9yIH07XG59O1xuXG5TZXJ2aWNlTWVzc2FnZXNbQ0xJRU5UX01FU1NBR0VTLndhaXRGb3JGaWxlRG93bmxvYWRdID0gZnVuY3Rpb24gKG1zZykge1xuICAgIHRoaXMuZGVidWdMb2cuZHJpdmVyTWVzc2FnZShtc2cpO1xuXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKHJlc29sdmUgPT4ge1xuICAgICAgICBpZiAodGhpcy5maWxlRG93bmxvYWRpbmdIYW5kbGVkKSB7XG4gICAgICAgICAgICB0aGlzLmZpbGVEb3dubG9hZGluZ0hhbmRsZWQgPSBmYWxzZTtcbiAgICAgICAgICAgIHJlc29sdmUodHJ1ZSk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZVxuICAgICAgICAgICAgdGhpcy5yZXNvbHZlV2FpdEZvckZpbGVEb3dubG9hZGluZ1Byb21pc2UgPSByZXNvbHZlO1xuICAgIH0pO1xufTtcbiJdfQ==