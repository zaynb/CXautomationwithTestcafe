"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// TODO: Fix https://github.com/DevExpress/testcafe/issues/4139 to get rid of Pinkie
const pinkie_1 = __importDefault(require("pinkie"));
const lodash_1 = require("lodash");
const get_callsite_1 = require("../../errors/get-callsite");
const client_function_builder_1 = __importDefault(require("../../client-functions/client-function-builder"));
const assertion_1 = __importDefault(require("./assertion"));
const delegated_api_1 = require("../../utils/delegated-api");
const warning_message_1 = __importDefault(require("../../notifications/warning-message"));
const get_browser_1 = __importDefault(require("../../utils/get-browser"));
const add_rendered_warning_1 = __importDefault(require("../../notifications/add-rendered-warning"));
const actions_1 = require("../../test-run/commands/actions");
const browser_manipulation_1 = require("../../test-run/commands/browser-manipulation");
const observation_1 = require("../../test-run/commands/observation");
const assert_type_1 = __importDefault(require("../request-hooks/assert-type"));
const execution_context_1 = require("./execution-context");
const types_1 = require("../../client-functions/types");
const test_run_1 = require("../../errors/test-run");
const originalThen = pinkie_1.default.resolve().then;
class TestController {
    constructor(testRun) {
        this._executionContext = null;
        this.testRun = testRun;
        this.executionChain = pinkie_1.default.resolve();
        this.warningLog = testRun.warningLog;
    }
    // NOTE: we track missing `awaits` by exposing a special custom Promise to user code.
    // Action or assertion is awaited if:
    // a)someone used `await` so Promise's `then` function executed
    // b)Promise chained by using one of the mixed-in controller methods
    //
    // In both scenarios, we check that callsite that produced Promise is equal to the one
    // that is currently missing await. This is required to workaround scenarios like this:
    //
    // var t2 = t.click('#btn1'); // <-- stores new callsiteWithoutAwait
    // await t2;                  // <-- callsiteWithoutAwait = null
    // t.click('#btn2');          // <-- stores new callsiteWithoutAwait
    // await t2.click('#btn3');   // <-- without check it will set callsiteWithoutAwait = null, so we will lost tracking
    _createExtendedPromise(promise, callsite) {
        const extendedPromise = promise.then(lodash_1.identity);
        const observedCallsites = this.testRun.observedCallsites;
        const markCallsiteAwaited = () => observedCallsites.callsitesWithoutAwait.delete(callsite);
        extendedPromise.then = function () {
            markCallsiteAwaited();
            return originalThen.apply(this, arguments);
        };
        delegated_api_1.delegateAPI(extendedPromise, TestController.API_LIST, {
            handler: this,
            proxyMethod: markCallsiteAwaited
        });
        return extendedPromise;
    }
    _enqueueTask(apiMethodName, createTaskExecutor) {
        const callsite = get_callsite_1.getCallsiteForMethod(apiMethodName);
        const executor = createTaskExecutor(callsite);
        this.executionChain.then = originalThen;
        this.executionChain = this.executionChain.then(executor);
        this.testRun.observedCallsites.callsitesWithoutAwait.add(callsite);
        this.executionChain = this._createExtendedPromise(this.executionChain, callsite);
        return this.executionChain;
    }
    _enqueueCommand(apiMethodName, CmdCtor, cmdArgs) {
        return this._enqueueTask(apiMethodName, callsite => {
            let command = null;
            try {
                command = new CmdCtor(cmdArgs, this.testRun);
            }
            catch (err) {
                err.callsite = callsite;
                throw err;
            }
            return () => {
                return this.testRun.executeAction(apiMethodName, command, callsite)
                    .catch(err => {
                    this.executionChain = pinkie_1.default.resolve();
                    throw err;
                });
            };
        });
    }
    _validateMultipleWindowCommand(apiMethodName) {
        const { disableMultipleWindows, browserConnection } = this.testRun;
        if (disableMultipleWindows)
            throw new test_run_1.MultipleWindowsModeIsDisabledError(apiMethodName);
        if (!browserConnection.activeWindowId)
            throw new test_run_1.MultipleWindowsModeIsNotAvailableInRemoteBrowserError(apiMethodName);
    }
    getExecutionContext() {
        if (!this._executionContext)
            this._executionContext = execution_context_1.createExecutionContext(this.testRun);
        return this._executionContext;
    }
    // API implementation
    // We need implementation methods to obtain correct callsites. If we use plain API
    // methods in chained wrappers then we will have callsite for the wrapped method
    // in this file instead of chained method callsite in user code.
    _ctx$getter() {
        return this.testRun.ctx;
    }
    _ctx$setter(val) {
        this.testRun.ctx = val;
        return this.testRun.ctx;
    }
    _fixtureCtx$getter() {
        return this.testRun.fixtureCtx;
    }
    _browser$getter() {
        return get_browser_1.default(this.testRun.browserConnection);
    }
    _click$(selector, options) {
        return this._enqueueCommand('click', actions_1.ClickCommand, { selector, options });
    }
    _rightClick$(selector, options) {
        return this._enqueueCommand('rightClick', actions_1.RightClickCommand, { selector, options });
    }
    _doubleClick$(selector, options) {
        return this._enqueueCommand('doubleClick', actions_1.DoubleClickCommand, { selector, options });
    }
    _hover$(selector, options) {
        return this._enqueueCommand('hover', actions_1.HoverCommand, { selector, options });
    }
    _drag$(selector, dragOffsetX, dragOffsetY, options) {
        return this._enqueueCommand('drag', actions_1.DragCommand, { selector, dragOffsetX, dragOffsetY, options });
    }
    _dragToElement$(selector, destinationSelector, options) {
        return this._enqueueCommand('dragToElement', actions_1.DragToElementCommand, { selector, destinationSelector, options });
    }
    _typeText$(selector, text, options) {
        return this._enqueueCommand('typeText', actions_1.TypeTextCommand, { selector, text, options });
    }
    _selectText$(selector, startPos, endPos, options) {
        return this._enqueueCommand('selectText', actions_1.SelectTextCommand, { selector, startPos, endPos, options });
    }
    _selectTextAreaContent$(selector, startLine, startPos, endLine, endPos, options) {
        return this._enqueueCommand('selectTextAreaContent', actions_1.SelectTextAreaContentCommand, {
            selector,
            startLine,
            startPos,
            endLine,
            endPos,
            options
        });
    }
    _selectEditableContent$(startSelector, endSelector, options) {
        return this._enqueueCommand('selectEditableContent', actions_1.SelectEditableContentCommand, {
            startSelector,
            endSelector,
            options
        });
    }
    _pressKey$(keys, options) {
        return this._enqueueCommand('pressKey', actions_1.PressKeyCommand, { keys, options });
    }
    _wait$(timeout) {
        return this._enqueueCommand('wait', observation_1.WaitCommand, { timeout });
    }
    _navigateTo$(url) {
        return this._enqueueCommand('navigateTo', actions_1.NavigateToCommand, { url });
    }
    _setFilesToUpload$(selector, filePath) {
        return this._enqueueCommand('setFilesToUpload', actions_1.SetFilesToUploadCommand, { selector, filePath });
    }
    _clearUpload$(selector) {
        return this._enqueueCommand('clearUpload', actions_1.ClearUploadCommand, { selector });
    }
    _takeScreenshot$(options) {
        if (options && typeof options !== 'object')
            options = { path: options };
        return this._enqueueCommand('takeScreenshot', browser_manipulation_1.TakeScreenshotCommand, options);
    }
    _takeElementScreenshot$(selector, ...args) {
        const commandArgs = { selector };
        if (args[1]) {
            commandArgs.path = args[0];
            commandArgs.options = args[1];
        }
        else if (typeof args[0] === 'object')
            commandArgs.options = args[0];
        else
            commandArgs.path = args[0];
        return this._enqueueCommand('takeElementScreenshot', browser_manipulation_1.TakeElementScreenshotCommand, commandArgs);
    }
    _resizeWindow$(width, height) {
        return this._enqueueCommand('resizeWindow', browser_manipulation_1.ResizeWindowCommand, { width, height });
    }
    _resizeWindowToFitDevice$(device, options) {
        return this._enqueueCommand('resizeWindowToFitDevice', browser_manipulation_1.ResizeWindowToFitDeviceCommand, { device, options });
    }
    _maximizeWindow$() {
        return this._enqueueCommand('maximizeWindow', browser_manipulation_1.MaximizeWindowCommand);
    }
    _switchToIframe$(selector) {
        return this._enqueueCommand('switchToIframe', actions_1.SwitchToIframeCommand, { selector });
    }
    _switchToMainWindow$() {
        return this._enqueueCommand('switchToMainWindow', actions_1.SwitchToMainWindowCommand);
    }
    _openWindow$(url) {
        const apiMethodName = 'openWindow';
        this._validateMultipleWindowCommand(apiMethodName);
        return this._enqueueCommand(apiMethodName, actions_1.OpenWindowCommand, { url });
    }
    _closeWindow$(window) {
        const apiMethodName = 'closeWindow';
        const windowId = (window === null || window === void 0 ? void 0 : window.id) || null;
        this._validateMultipleWindowCommand(apiMethodName);
        return this._enqueueCommand(apiMethodName, actions_1.CloseWindowCommand, { windowId });
    }
    _getCurrentWindow$() {
        const apiMethodName = 'getCurrentWindow';
        this._validateMultipleWindowCommand(apiMethodName);
        return this._enqueueCommand(apiMethodName, actions_1.GetCurrentWindowCommand);
    }
    _switchToWindow$(windowSelector) {
        const apiMethodName = 'switchToWindow';
        this._validateMultipleWindowCommand(apiMethodName);
        let command;
        let args;
        if (typeof windowSelector === 'function') {
            command = actions_1.SwitchToWindowByPredicateCommand;
            args = { findWindow: windowSelector };
        }
        else {
            command = actions_1.SwitchToWindowCommand;
            args = { windowId: windowSelector === null || windowSelector === void 0 ? void 0 : windowSelector.id };
        }
        return this._enqueueCommand(apiMethodName, command, args);
    }
    _switchToParentWindow$() {
        const apiMethodName = 'switchToParentWindow';
        this._validateMultipleWindowCommand(apiMethodName);
        return this._enqueueCommand(apiMethodName, actions_1.SwitchToParentWindowCommand);
    }
    _switchToPreviousWindow$() {
        const apiMethodName = 'switchToPreviousWindow';
        this._validateMultipleWindowCommand(apiMethodName);
        return this._enqueueCommand(apiMethodName, actions_1.SwitchToPreviousWindowCommand);
    }
    _eval$(fn, options) {
        if (!lodash_1.isNil(options))
            options = lodash_1.assign({}, options, { boundTestRun: this });
        const builder = new client_function_builder_1.default(fn, options, { instantiation: 'eval', execution: 'eval' });
        const clientFn = builder.getFunction();
        return clientFn();
    }
    _setNativeDialogHandler$(fn, options) {
        return this._enqueueCommand('setNativeDialogHandler', actions_1.SetNativeDialogHandlerCommand, {
            dialogHandler: { fn, options }
        });
    }
    _getNativeDialogHistory$() {
        const name = 'getNativeDialogHistory';
        const callsite = get_callsite_1.getCallsiteForMethod(name);
        return this.testRun.executeAction(name, new actions_1.GetNativeDialogHistoryCommand(), callsite);
    }
    _getBrowserConsoleMessages$() {
        const name = 'getBrowserConsoleMessages';
        const callsite = get_callsite_1.getCallsiteForMethod(name);
        return this.testRun.executeAction(name, new actions_1.GetBrowserConsoleMessagesCommand(), callsite);
    }
    _checkForExcessiveAwaits(selectorCallsiteList, expectCallsite) {
        for (const selectorCallsite of selectorCallsiteList) {
            if (selectorCallsite.filename === expectCallsite.filename &&
                selectorCallsite.lineNum === expectCallsite.lineNum) {
                add_rendered_warning_1.default(this.warningLog, warning_message_1.default.excessiveAwaitInAssertion, selectorCallsite);
                selectorCallsiteList.delete(selectorCallsite);
            }
        }
    }
    _expect$(actual) {
        const callsite = get_callsite_1.getCallsiteForMethod('expect');
        this._checkForExcessiveAwaits(this.testRun.observedCallsites.snapshotPropertyCallsites, callsite);
        if (types_1.isClientFunction(actual))
            add_rendered_warning_1.default(this.warningLog, warning_message_1.default.assertedClientFunctionInstance, callsite);
        else if (types_1.isSelector(actual))
            add_rendered_warning_1.default(this.warningLog, warning_message_1.default.assertedSelectorInstance, callsite);
        return new assertion_1.default(actual, this, callsite);
    }
    _debug$() {
        return this._enqueueCommand('debug', observation_1.DebugCommand);
    }
    _setTestSpeed$(speed) {
        return this._enqueueCommand('setTestSpeed', actions_1.SetTestSpeedCommand, { speed });
    }
    _setPageLoadTimeout$(duration) {
        return this._enqueueCommand('setPageLoadTimeout', actions_1.SetPageLoadTimeoutCommand, { duration });
    }
    _useRole$(role) {
        return this._enqueueCommand('useRole', actions_1.UseRoleCommand, { role });
    }
    _addRequestHooks$(...hooks) {
        return this._enqueueTask('addRequestHooks', () => {
            hooks = lodash_1.flattenDeep(hooks);
            assert_type_1.default(hooks);
            hooks.forEach(hook => this.testRun.addRequestHook(hook));
        });
    }
    _removeRequestHooks$(...hooks) {
        return this._enqueueTask('removeRequestHooks', () => {
            hooks = lodash_1.flattenDeep(hooks);
            assert_type_1.default(hooks);
            hooks.forEach(hook => this.testRun.removeRequestHook(hook));
        });
    }
}
exports.default = TestController;
TestController.API_LIST = delegated_api_1.getDelegatedAPIList(TestController.prototype);
delegated_api_1.delegateAPI(TestController.prototype, TestController.API_LIST, { useCurrentCtxAsHandler: true });
module.exports = exports.default;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYXBpL3Rlc3QtY29udHJvbGxlci9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7OztBQUFBLG9GQUFvRjtBQUNwRixvREFBNkI7QUFDN0IsbUNBS2dCO0FBRWhCLDREQUFpRTtBQUNqRSw2R0FBbUY7QUFDbkYsNERBQW9DO0FBQ3BDLDZEQUE2RTtBQUM3RSwwRkFBa0U7QUFDbEUsMEVBQWlEO0FBQ2pELG9HQUFrRTtBQUVsRSw2REE4QnlDO0FBRXpDLHVGQU1zRDtBQUV0RCxxRUFBZ0Y7QUFDaEYsK0VBQWlFO0FBQ2pFLDJEQUE4RTtBQUM5RSx3REFBNEU7QUFFNUUsb0RBRytCO0FBRS9CLE1BQU0sWUFBWSxHQUFHLGdCQUFPLENBQUMsT0FBTyxFQUFFLENBQUMsSUFBSSxDQUFDO0FBRTVDLE1BQXFCLGNBQWM7SUFDL0IsWUFBYSxPQUFPO1FBQ2hCLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxJQUFJLENBQUM7UUFFOUIsSUFBSSxDQUFDLE9BQU8sR0FBaUIsT0FBTyxDQUFDO1FBQ3JDLElBQUksQ0FBQyxjQUFjLEdBQVUsZ0JBQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUMvQyxJQUFJLENBQUMsVUFBVSxHQUFjLE9BQU8sQ0FBQyxVQUFVLENBQUM7SUFDcEQsQ0FBQztJQUVELHFGQUFxRjtJQUNyRixxQ0FBcUM7SUFDckMsK0RBQStEO0lBQy9ELG9FQUFvRTtJQUNwRSxFQUFFO0lBQ0Ysc0ZBQXNGO0lBQ3RGLHVGQUF1RjtJQUN2RixFQUFFO0lBQ0Ysb0VBQW9FO0lBQ3BFLGdFQUFnRTtJQUNoRSxvRUFBb0U7SUFDcEUsb0hBQW9IO0lBQ3BILHNCQUFzQixDQUFFLE9BQU8sRUFBRSxRQUFRO1FBQ3JDLE1BQU0sZUFBZSxHQUFPLE9BQU8sQ0FBQyxJQUFJLENBQUMsaUJBQVEsQ0FBQyxDQUFDO1FBQ25ELE1BQU0saUJBQWlCLEdBQUssSUFBSSxDQUFDLE9B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LEVBQUUsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO1FBQzdELENBQUMsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztJQUVELG9CQUFvQixDQUFFLEdBQUcsS0FBSztRQUMxQixPQUFPLElBQUksQ0FBQyxZQUFZLENBQUMsb0JBQW9CLEVBQUUsR0FBRyxFQUFFO1lBQ2hELEtBQUssR0FBRyxvQkFBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBRXZCLHFCQUFxQixDQUFDLEtBQUssQ0FBQyxDQUFDO1lBRTdCLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7UUFDaEUsQ0FBQyxDQUFDLENBQUM7SUFDUCxDQUFDO0NBQ0o7QUE3WEQsaUNBNlhDO0FBRUQsY0FBYyxDQUFDLFFBQVEsR0FBRyxtQ0FBbUIsQ0FBQyxjQUFjLENBQUMsU0FBUyxDQUFDLENBQUM7QUFFeEUsMkJBQVcsQ0FBQyxjQUFjLENBQUMsU0FBUyxFQUFFLGNBQWMsQ0FBQyxRQUFRLEVBQUUsRUFBRSxzQkFBc0IsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gVE9ETzogRml4IGh0dHBzOi8vZ2l0aHViLmNvbS9EZXZFeHByZXNzL3Rlc3RjYWZlL2lzc3Vlcy80MTM5IHRvIGdldCByaWQgb2YgUGlua2llXG5pbXBvcnQgUHJvbWlzZSBmcm9tICdwaW5raWUnO1xuaW1wb3J0IHtcbiAgICBpZGVudGl0eSxcbiAgICBhc3NpZ24sXG4gICAgaXNOaWwgYXMgaXNOdWxsT3JVbmRlZmluZWQsXG4gICAgZmxhdHRlbkRlZXAgYXMgZmxhdHRlblxufSBmcm9tICdsb2Rhc2gnO1xuXG5pbXBvcnQgeyBnZXRDYWxsc2l0ZUZvck1ldGhvZCB9IGZyb20gJy4uLy4uL2Vycm9ycy9nZXQtY2FsbHNpdGUnO1xuaW1wb3J0IENsaWVudEZ1bmN0aW9uQnVpbGRlciBmcm9tICcuLi8uLi9jbGllbnQtZnVuY3Rpb25zL2NsaWVudC1mdW5jdGlvbi1idWlsZGVyJztcbmltcG9ydCBBc3NlcnRpb24gZnJvbSAnLi9hc3NlcnRpb24nO1xuaW1wb3J0IHsgZ2V0RGVsZWdhdGVkQVBJTGlzdCwgZGVsZWdhdGVBUEkgfSBmcm9tICcuLi8uLi91dGlscy9kZWxlZ2F0ZWQtYXBpJztcbmltcG9ydCBXQVJOSU5HX01FU1NBR0UgZnJvbSAnLi4vLi4vbm90aWZpY2F0aW9ucy93YXJuaW5nLW1lc3NhZ2UnO1xuaW1wb3J0IGdldEJyb3dzZXIgZnJvbSAnLi4vLi4vdXRpbHMvZ2V0LWJyb3dzZXInO1xuaW1wb3J0IGFkZFdhcm5pbmcgZnJvbSAnLi4vLi4vbm90aWZpY2F0aW9ucy9hZGQtcmVuZGVyZWQtd2FybmluZyc7XG5cbmltcG9ydCB7XG4gICAgQ2xpY2tDb21tYW5kLFxuICAgIFJpZ2h0Q2xpY2tDb21tYW5kLFxuICAgIERvdWJsZUNsaWNrQ29tbWFuZCxcbiAgICBIb3ZlckNvbW1hbmQsXG4gICAgRHJhZ0NvbW1hbmQsXG4gICAgRHJhZ1RvRWxlbWVudENvbW1hbmQsXG4gICAgVHlwZVRleHRDb21tYW5kLFxuICAgIFNlbGVjdFRleHRDb21tYW5kLFxuICAgIFNlbGVjdFRleHRBcmVhQ29udGVudENvbW1hbmQsXG4gICAgU2VsZWN0RWRpdGFibGVDb250ZW50Q29tbWFuZCxcbiAgICBQcmVzc0tleUNvbW1hbmQsXG4gICAgTmF2aWdhdGVUb0NvbW1hbmQsXG4gICAgU2V0RmlsZXNUb1VwbG9hZENvbW1hbmQsXG4gICAgQ2xlYXJVcGxvYWRDb21tYW5kLFxuICAgIFN3aXRjaFRvSWZyYW1lQ29tbWFuZCxcbiAgICBTd2l0Y2hUb01haW5XaW5kb3dDb21tYW5kLFxuICAgIE9wZW5XaW5kb3dDb21tYW5kLFxuICAgIENsb3NlV2luZG93Q29tbWFuZCxcbiAgICBHZXRDdXJyZW50V2luZG93Q29tbWFuZCxcbiAgICBTd2l0Y2hUb1dpbmRvd0NvbW1hbmQsXG4gICAgU3dpdGNoVG9XaW5kb3dCeVByZWRpY2F0ZUNvbW1hbmQsXG4gICAgU3dpdGNoVG9QYXJlbnRXaW5kb3dDb21tYW5kLFxuICAgIFN3aXRjaFRvUHJldmlvdXNXaW5kb3dDb21tYW5kLFxuICAgIFNldE5hdGl2ZURpYWxvZ0hhbmRsZXJDb21tYW5kLFxuICAgIEdldE5hdGl2ZURpYWxvZ0hpc3RvcnlDb21tYW5kLFxuICAgIEdldEJyb3dzZXJDb25zb2xlTWVzc2FnZXNDb21tYW5kLFxuICAgIFNldFRlc3RTcGVlZENvbW1hbmQsXG4gICAgU2V0UGFnZUxvYWRUaW1lb3V0Q29tbWFuZCxcbiAgICBVc2VSb2xlQ29tbWFuZFxufSBmcm9tICcuLi8uLi90ZXN0LXJ1bi9jb21tYW5kcy9hY3Rpb25zJztcblxuaW1wb3J0IHtcbiAgICBUYWtlU2NyZWVuc2hvdENvbW1hbmQsXG4gICAgVGFrZUVsZW1lbnRTY3JlZW5zaG90Q29tbWFuZCxcbiAgICBSZXNpemVXaW5kb3dDb21tYW5kLFxuICAgIFJlc2l6ZVdpbmRvd1RvRml0RGV2aWNlQ29tbWFuZCxcbiAgICBNYXhpbWl6ZVdpbmRvd0NvbW1hbmRcbn0gZnJvbSAnLi4vLi4vdGVzdC1ydW4vY29tbWFuZHMvYnJvd3Nlci1tYW5pcHVsYXRpb24nO1xuXG5pbXBvcnQgeyBXYWl0Q29tbWFuZCwgRGVidWdDb21tYW5kIH0gZnJvbSAnLi4vLi4vdGVzdC1ydW4vY29tbWFuZHMvb2JzZXJ2YXRpb24nO1xuaW1wb3J0IGFzc2VydFJlcXVlc3RIb29rVHlwZSBmcm9tICcuLi9yZXF1ZXN0LWhvb2tzL2Fzc2VydC10eXBlJztcbmltcG9ydCB7IGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQgYXMgY3JlYXRlQ29udGV4dCB9IGZyb20gJy4vZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgaXNDbGllbnRGdW5jdGlvbiwgaXNTZWxlY3RvciB9IGZyb20gJy4uLy4uL2NsaWVudC1mdW5jdGlvbnMvdHlwZXMnO1xuXG5pbXBvcnQge1xuICAgIE11bHRpcGxlV2luZG93c01vZGVJc0Rpc2FibGVkRXJyb3IsXG4gICAgTXVsdGlwbGVXaW5kb3dzTW9kZUlzTm90QXZhaWxhYmxlSW5SZW1vdGVCcm93c2VyRXJyb3Jcbn0gZnJvbSAnLi4vLi4vZXJyb3JzL3Rlc3QtcnVuJztcblxuY29uc3Qgb3JpZ2luYWxUaGVuID0gUHJvbWlzZS5yZXNvbHZlKCkudGhlbjtcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVGVzdENvbnRyb2xsZXIge1xuICAgIGNvbnN0cnVjdG9yICh0ZXN0UnVuKSB7XG4gICAgICAgIHRoaXMuX2V4ZWN1dGlvbkNvbnRleHQgPSBudWxsO1xuXG4gICAgICAgIHRoaXMudGVzdFJ1biAgICAgICAgICAgICAgID0gdGVzdFJ1bjtcbiAgICAgICAgdGhpcy5leGVjdXRpb25DaGFpbiAgICAgICAgPSBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgdGhpcy53YXJuaW5nTG9nICAgICAgICAgICAgPSB0ZXN0UnVuLndhcm5pbmdMb2c7XG4gICAgfVxuXG4gICAgLy8gTk9URTogd2UgdHJhY2sgbWlzc2luZyBgYXdhaXRzYCBieSBleHBvc2luZyBhIHNwZWNpYWwgY3VzdG9tIFByb21pc2UgdG8gdXNlciBjb2RlLlxuICAgIC8vIEFjdGlvbiBvciBhc3NlcnRpb24gaXMgYXdhaXRlZCBpZjpcbiAgICAvLyBhKXNvbWVvbmUgdXNlZCBgYXdhaXRgIHNvIFByb21pc2UncyBgdGhlbmAgZnVuY3Rpb24gZXhlY3V0ZWRcbiAgICAvLyBiKVByb21pc2UgY2hhaW5lZCBieSB1c2luZyBvbmUgb2YgdGhlIG1peGVkLWluIGNvbnRyb2xsZXIgbWV0aG9kc1xuICAgIC8vXG4gICAgLy8gSW4gYm90aCBzY2VuYXJpb3MsIHdlIGNoZWNrIHRoYXQgY2FsbHNpdGUgdGhhdCBwcm9kdWNlZCBQcm9taXNlIGlzIGVxdWFsIHRvIHRoZSBvbmVcbiAgICAvLyB0aGF0IGlzIGN1cnJlbnRseSBtaXNzaW5nIGF3YWl0LiBUaGlzIGlzIHJlcXVpcmVkIHRvIHdvcmthcm91bmQgc2NlbmFyaW9zIGxpa2UgdGhpczpcbiAgICAvL1xuICAgIC8vIHZhciB0MiA9IHQuY2xpY2soJyNidG4xJyk7IC8vIDwtLSBzdG9yZXMgbmV3IGNhbGxzaXRlV2l0aG91dEF3YWl0XG4gICAgLy8gYXdhaXQgdDI7ICAgICAgICAgICAgICAgICAgLy8gPC0tIGNhbGxzaXRlV2l0aG91dEF3YWl0ID0gbnVsbFxuICAgIC8vIHQuY2xpY2soJyNidG4yJyk7ICAgICAgICAgIC8vIDwtLSBzdG9yZXMgbmV3IGNhbGxzaXRlV2l0aG91dEF3YWl0XG4gICAgLy8gYXdhaXQgdDIuY2xpY2soJyNidG4zJyk7ICAgLy8gPC0tIHdpdGhvdXQgY2hlY2sgaXQgd2lsbCBzZXQgY2FsbHNpdGVXaXRob3V0QXdhaXQgPSBudWxsLCBzbyB3ZSB3aWxsIGxvc3QgdHJhY2tpbmdcbiAgICBfY3JlYXRlRXh0ZW5kZWRQcm9taXNlIChwcm9taXNlLCBjYWxsc2l0ZSkge1xuICAgICAgICBjb25zdCBleHRlbmRlZFByb21pc2UgICAgID0gcHJvbWlzZS50aGVuKGlkZW50aXR5KTtcbiAgICAgICAgY29uc3Qgb2JzZXJ2ZWRDYWxsc2l0ZXMgICA9IHRoaXMudGVzdFJ1bi5vYnNlcnZlZENhbGxzaXRlcztcbiAgICAgICAgY29uc3QgbWFya0NhbGxzaXRlQXdhaXRlZCA9ICgpID0+IG9ic2VydmVkQ2FsbHNpdGVzLmNhbGxzaXRlc1dpdGhvdXRBd2FpdC5kZWxldGUoY2FsbHNpdGUpO1xuXG4gICAgICAgIGV4dGVuZGVkUHJvbWlzZS50aGVuID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgbWFya0NhbGxzaXRlQXdhaXRlZCgpO1xuXG4gICAgICAgICAgICByZXR1cm4gb3JpZ2luYWxUaGVuLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgIH07XG5cbiAgICAgICAgZGVsZWdhdGVBUEkoZXh0ZW5kZWRQcm9taXNlLCBUZXN0Q29udHJvbGxlci5BUElfTElTVCwge1xuICAgICAgICAgICAgaGFuZGxlcjogICAgIHRoaXMsXG4gICAgICAgICAgICBwcm94eU1ldGhvZDogbWFya0NhbGxzaXRlQXdhaXRlZFxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gZXh0ZW5kZWRQcm9taXNlO1xuICAgIH1cblxuICAgIF9lbnF1ZXVlVGFzayAoYXBpTWV0aG9kTmFtZSwgY3JlYXRlVGFza0V4ZWN1dG9yKSB7XG4gICAgICAgIGNvbnN0IGNhbGxzaXRlID0gZ2V0Q2FsbHNpdGVGb3JNZXRob2QoYXBpTWV0aG9kTmFtZSk7XG4gICAgICAgIGNvbnN0IGV4ZWN1dG9yID0gY3JlYXRlVGFza0V4ZWN1dG9yKGNhbGxzaXRlKTtcblxuICAgICAgICB0aGlzLmV4ZWN1dGlvbkNoYWluLnRoZW4gPSBvcmlnaW5hbFRoZW47XG4gICAgICAgIHRoaXMuZXhlY3V0aW9uQ2hhaW4gICAgICA9IHRoaXMuZXhlY3V0aW9uQ2hhaW4udGhlbihleGVjdXRvcik7XG5cbiAgICAgICAgdGhpcy50ZXN0UnVuLm9ic2VydmVkQ2FsbHNpdGVzLmNhbGxzaXRlc1dpdGhvdXRBd2FpdC5hZGQoY2FsbHNpdGUpO1xuXG4gICAgICAgIHRoaXMuZXhlY3V0aW9uQ2hhaW4gPSB0aGlzLl9jcmVhdGVFeHRlbmRlZFByb21pc2UodGhpcy5leGVjdXRpb25DaGFpbiwgY2FsbHNpdGUpO1xuXG4gICAgICAgIHJldHVybiB0aGlzLmV4ZWN1dGlvbkNoYWluO1xuICAgIH1cblxuICAgIF9lbnF1ZXVlQ29tbWFuZCAoYXBpTWV0aG9kTmFtZSwgQ21kQ3RvciwgY21kQXJncykge1xuICAgICAgICByZXR1cm4gdGhpcy5fZW5xdWV1ZVRhc2soYXBpTWV0aG9kTmFtZSwgY2FsbHNpdGUgPT4ge1xuICAgICAgICAgICAgbGV0IGNvbW1hbmQgPSBudWxsO1xuXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbW1hbmQgPSBuZXcgQ21kQ3RvcihjbWRBcmdzLCB0aGlzLnRlc3RSdW4pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgICAgIGVyci5jYWxsc2l0ZSA9IGNhbGxzaXRlO1xuICAgICAgICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy50ZXN0UnVuLmV4ZWN1dGVBY3Rpb24oYXBpTWV0aG9kTmFtZSwgY29tbWFuZCwgY2FsbHNpdGUpXG4gICAgICAgICAgICAgICAgICAgIC5jYXRjaChlcnIgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5leGVjdXRpb25DaGFpbiA9IFByb21pc2UucmVzb2x2ZSgpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgX3ZhbGlkYXRlTXVsdGlwbGVXaW5kb3dDb21tYW5kIChhcGlNZXRob2ROYW1lKSB7XG4gICAgICAgIGNvbnN0IHsgZGlzYWJsZU11bHRpcGxlV2luZG93cywgYnJvd3NlckNvbm5lY3Rpb24gfSA9IHRoaXMudGVzdFJ1bjtcblxuICAgICAgICBpZiAoZGlzYWJsZU11bHRpcGxlV2luZG93cylcbiAgICAgICAgICAgIHRocm93IG5ldyBNdWx0aXBsZVdpbmRvd3NNb2RlSXNEaXNhYmxlZEVycm9yKGFwaU1ldGhvZE5hbWUpO1xuXG4gICAgICAgIGlmICghYnJvd3NlckNvbm5lY3Rpb24uYWN0aXZlV2luZG93SWQpXG4gICAgICAgICAgICB0aHJvdyBuZXcgTXVsdGlwbGVXaW5kb3dzTW9kZUlzTm90QXZhaWxhYmxlSW5SZW1vdGVCcm93c2VyRXJyb3IoYXBpTWV0aG9kTmFtZSk7XG4gICAgfVxuXG4gICAgZ2V0RXhlY3V0aW9uQ29udGV4dCAoKSB7XG4gICAgICAgIGlmICghdGhpcy5fZXhlY3V0aW9uQ29udGV4dClcbiAgICAgICAgICAgIHRoaXMuX2V4ZWN1dGlvbkNvbnRleHQgPSBjcmVhdGVDb250ZXh0KHRoaXMudGVzdFJ1bik7XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuX2V4ZWN1dGlvbkNvbnRleHQ7XG4gICAgfVxuXG4gICAgLy8gQVBJIGltcGxlbWVudGF0aW9uXG4gICAgLy8gV2UgbmVlZCBpbXBsZW1lbnRhdGlvbiBtZXRob2RzIHRvIG9idGFpbiBjb3JyZWN0IGNhbGxzaXRlcy4gSWYgd2UgdXNlIHBsYWluIEFQSVxuICAgIC8vIG1ldGhvZHMgaW4gY2hhaW5lZCB3cmFwcGVycyB0aGVuIHdlIHdpbGwgaGF2ZSBjYWxsc2l0ZSBmb3IgdGhlIHdyYXBwZWQgbWV0aG9kXG4gICAgLy8gaW4gdGhpcyBmaWxlIGluc3RlYWQgb2YgY2hhaW5lZCBtZXRob2QgY2FsbHNpdGUgaW4gdXNlciBjb2RlLlxuICAgIF9jdHgkZ2V0dGVyICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMudGVzdFJ1bi5jdHg7XG4gICAgfVxuXG4gICAgX2N0eCRzZXR0ZXIgKHZhbCkge1xuICAgICAgICB0aGlzLnRlc3RSdW4uY3R4ID0gdmFsO1xuXG4gICAgICAgIHJldHVybiB0aGlzLnRlc3RSdW4uY3R4O1xuICAgIH1cblxuICAgIF9maXh0dXJlQ3R4JGdldHRlciAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnRlc3RSdW4uZml4dHVyZUN0eDtcbiAgICB9XG5cbiAgICBfYnJvd3NlciRnZXR0ZXIgKCkge1xuICAgICAgICByZXR1cm4gZ2V0QnJvd3Nlcih0aGlzLnRlc3RSdW4uYnJvd3NlckNvbm5lY3Rpb24pO1xuICAgIH1cblxuICAgIF9jbGljayQgKHNlbGVjdG9yLCBvcHRpb25zKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9lbnF1ZXVlQ29tbWFuZCgnY2xpY2snLCBDbGlja0NvbW1hbmQsIHsgc2VsZWN0b3IsIG9wdGlvbnMgfSk7XG4gICAgfVxuXG4gICAgX3JpZ2h0Q2xpY2skIChzZWxlY3Rvciwgb3B0aW9ucykge1xuICAgICAgICByZXR1cm4gdGhpcy5fZW5xdWV1ZUNvbW1hbmQoJ3JpZ2h0Q2xpY2snLCBSaWdodENsaWNrQ29tbWFuZCwgeyBzZWxlY3Rvciwgb3B0aW9ucyB9KTtcbiAgICB9XG5cbiAgICBfZG91YmxlQ2xpY2skIChzZWxlY3Rvciwgb3B0aW9ucykge1xuICAgICAgICByZXR1cm4gdGhpcy5fZW5xdWV1ZUNvbW1hbmQoJ2RvdWJsZUNsaWNrJywgRG91YmxlQ2xpY2tDb21tYW5kLCB7IHNlbGVjdG9yLCBvcHRpb25zIH0pO1xuICAgIH1cblxuICAgIF9ob3ZlciQgKHNlbGVjdG9yLCBvcHRpb25zKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9lbnF1ZXVlQ29tbWFuZCgnaG92ZXInLCBIb3ZlckNvbW1hbmQsIHsgc2VsZWN0b3IsIG9wdGlvbnMgfSk7XG4gICAgfVxuXG4gICAgX2RyYWckIChzZWxlY3RvciwgZHJhZ09mZnNldFgsIGRyYWdPZmZzZXRZLCBvcHRpb25zKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9lbnF1ZXVlQ29tbWFuZCgnZHJhZycsIERyYWdDb21tYW5kLCB7IHNlbGVjdG9yLCBkcmFnT2Zmc2V0WCwgZHJhZ09mZnNldFksIG9wdGlvbnMgfSk7XG4gICAgfVxuXG4gICAgX2RyYWdUb0VsZW1lbnQkIChzZWxlY3RvciwgZGVzdGluYXRpb25TZWxlY3Rvciwgb3B0aW9ucykge1xuICAgICAgICByZXR1cm4gdGhpcy5fZW5xdWV1ZUNvbW1hbmQoJ2RyYWdUb0VsZW1lbnQnLCBEcmFnVG9FbGVtZW50Q29tbWFuZCwgeyBzZWxlY3RvciwgZGVzdGluYXRpb25TZWxlY3Rvciwgb3B0aW9ucyB9KTtcbiAgICB9XG5cbiAgICBfdHlwZVRleHQkIChzZWxlY3RvciwgdGV4dCwgb3B0aW9ucykge1xuICAgICAgICByZXR1cm4gdGhpcy5fZW5xdWV1ZUNvbW1hbmQoJ3R5cGVUZXh0JywgVHlwZVRleHRDb21tYW5kLCB7IHNlbGVjdG9yLCB0ZXh0LCBvcHRpb25zIH0pO1xuICAgIH1cblxuICAgIF9zZWxlY3RUZXh0JCAoc2VsZWN0b3IsIHN0YXJ0UG9zLCBlbmRQb3MsIG9wdGlvbnMpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2VucXVldWVDb21tYW5kKCdzZWxlY3RUZXh0JywgU2VsZWN0VGV4dENvbW1hbmQsIHsgc2VsZWN0b3IsIHN0YXJ0UG9zLCBlbmRQb3MsIG9wdGlvbnMgfSk7XG4gICAgfVxuXG4gICAgX3NlbGVjdFRleHRBcmVhQ29udGVudCQgKHNlbGVjdG9yLCBzdGFydExpbmUsIHN0YXJ0UG9zLCBlbmRMaW5lLCBlbmRQb3MsIG9wdGlvbnMpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2VucXVldWVDb21tYW5kKCdzZWxlY3RUZXh0QXJlYUNvbnRlbnQnLCBTZWxlY3RUZXh0QXJlYUNvbnRlbnRDb21tYW5kLCB7XG4gICAgICAgICAgICBzZWxlY3RvcixcbiAgICAgICAgICAgIHN0YXJ0TGluZSxcbiAgICAgICAgICAgIHN0YXJ0UG9zLFxuICAgICAgICAgICAgZW5kTGluZSxcbiAgICAgICAgICAgIGVuZFBvcyxcbiAgICAgICAgICAgIG9wdGlvbnNcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgX3NlbGVjdEVkaXRhYmxlQ29udGVudCQgKHN0YXJ0U2VsZWN0b3IsIGVuZFNlbGVjdG9yLCBvcHRpb25zKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9lbnF1ZXVlQ29tbWFuZCgnc2VsZWN0RWRpdGFibGVDb250ZW50JywgU2VsZWN0RWRpdGFibGVDb250ZW50Q29tbWFuZCwge1xuICAgICAgICAgICAgc3RhcnRTZWxlY3RvcixcbiAgICAgICAgICAgIGVuZFNlbGVjdG9yLFxuICAgICAgICAgICAgb3B0aW9uc1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBfcHJlc3NLZXkkIChrZXlzLCBvcHRpb25zKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9lbnF1ZXVlQ29tbWFuZCgncHJlc3NLZXknLCBQcmVzc0tleUNvbW1hbmQsIHsga2V5cywgb3B0aW9ucyB9KTtcbiAgICB9XG5cbiAgICBfd2FpdCQgKHRpbWVvdXQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2VucXVldWVDb21tYW5kKCd3YWl0JywgV2FpdENvbW1hbmQsIHsgdGltZW91dCB9KTtcbiAgICB9XG5cbiAgICBfbmF2aWdhdGVUbyQgKHVybCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fZW5xdWV1ZUNvbW1hbmQoJ25hdmlnYXRlVG8nLCBOYXZpZ2F0ZVRvQ29tbWFuZCwgeyB1cmwgfSk7XG4gICAgfVxuXG4gICAgX3NldEZpbGVzVG9VcGxvYWQkIChzZWxlY3RvciwgZmlsZVBhdGgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2VucXVldWVDb21tYW5kKCdzZXRGaWxlc1RvVXBsb2FkJywgU2V0RmlsZXNUb1VwbG9hZENvbW1hbmQsIHsgc2VsZWN0b3IsIGZpbGVQYXRoIH0pO1xuICAgIH1cblxuICAgIF9jbGVhclVwbG9hZCQgKHNlbGVjdG9yKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9lbnF1ZXVlQ29tbWFuZCgnY2xlYXJVcGxvYWQnLCBDbGVhclVwbG9hZENvbW1hbmQsIHsgc2VsZWN0b3IgfSk7XG4gICAgfVxuXG4gICAgX3Rha2VTY3JlZW5zaG90JCAob3B0aW9ucykge1xuICAgICAgICBpZiAob3B0aW9ucyAmJiB0eXBlb2Ygb3B0aW9ucyAhPT0gJ29iamVjdCcpXG4gICAgICAgICAgICBvcHRpb25zID0geyBwYXRoOiBvcHRpb25zIH07XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuX2VucXVldWVDb21tYW5kKCd0YWtlU2NyZWVuc2hvdCcsIFRha2VTY3JlZW5zaG90Q29tbWFuZCwgb3B0aW9ucyk7XG4gICAgfVxuXG4gICAgX3Rha2VFbGVtZW50U2NyZWVuc2hvdCQgKHNlbGVjdG9yLCAuLi5hcmdzKSB7XG4gICAgICAgIGNvbnN0IGNvbW1hbmRBcmdzID0geyBzZWxlY3RvciB9O1xuXG4gICAgICAgIGlmIChhcmdzWzFdKSB7XG4gICAgICAgICAgICBjb21tYW5kQXJncy5wYXRoICAgID0gYXJnc1swXTtcbiAgICAgICAgICAgIGNvbW1hbmRBcmdzLm9wdGlvbnMgPSBhcmdzWzFdO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHR5cGVvZiBhcmdzWzBdID09PSAnb2JqZWN0JylcbiAgICAgICAgICAgIGNvbW1hbmRBcmdzLm9wdGlvbnMgPSBhcmdzWzBdO1xuICAgICAgICBlbHNlXG4gICAgICAgICAgICBjb21tYW5kQXJncy5wYXRoID0gYXJnc1swXTtcblxuICAgICAgICByZXR1cm4gdGhpcy5fZW5xdWV1ZUNvbW1hbmQoJ3Rha2VFbGVtZW50U2NyZWVuc2hvdCcsIFRha2VFbGVtZW50U2NyZWVuc2hvdENvbW1hbmQsIGNvbW1hbmRBcmdzKTtcbiAgICB9XG5cbiAgICBfcmVzaXplV2luZG93JCAod2lkdGgsIGhlaWdodCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fZW5xdWV1ZUNvbW1hbmQoJ3Jlc2l6ZVdpbmRvdycsIFJlc2l6ZVdpbmRvd0NvbW1hbmQsIHsgd2lkdGgsIGhlaWdodCB9KTtcbiAgICB9XG5cbiAgICBfcmVzaXplV2luZG93VG9GaXREZXZpY2UkIChkZXZpY2UsIG9wdGlvbnMpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2VucXVldWVDb21tYW5kKCdyZXNpemVXaW5kb3dUb0ZpdERldmljZScsIFJlc2l6ZVdpbmRvd1RvRml0RGV2aWNlQ29tbWFuZCwgeyBkZXZpY2UsIG9wdGlvbnMgfSk7XG4gICAgfVxuXG4gICAgX21heGltaXplV2luZG93JCAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9lbnF1ZXVlQ29tbWFuZCgnbWF4aW1pemVXaW5kb3cnLCBNYXhpbWl6ZVdpbmRvd0NvbW1hbmQpO1xuICAgIH1cblxuICAgIF9zd2l0Y2hUb0lmcmFtZSQgKHNlbGVjdG9yKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9lbnF1ZXVlQ29tbWFuZCgnc3dpdGNoVG9JZnJhbWUnLCBTd2l0Y2hUb0lmcmFtZUNvbW1hbmQsIHsgc2VsZWN0b3IgfSk7XG4gICAgfVxuXG4gICAgX3N3aXRjaFRvTWFpbldpbmRvdyQgKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fZW5xdWV1ZUNvbW1hbmQoJ3N3aXRjaFRvTWFpbldpbmRvdycsIFN3aXRjaFRvTWFpbldpbmRvd0NvbW1hbmQpO1xuICAgIH1cblxuICAgIF9vcGVuV2luZG93JCAodXJsKSB7XG4gICAgICAgIGNvbnN0IGFwaU1ldGhvZE5hbWUgPSAnb3BlbldpbmRvdyc7XG5cbiAgICAgICAgdGhpcy5fdmFsaWRhdGVNdWx0aXBsZVdpbmRvd0NvbW1hbmQoYXBpTWV0aG9kTmFtZSk7XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuX2VucXVldWVDb21tYW5kKGFwaU1ldGhvZE5hbWUsIE9wZW5XaW5kb3dDb21tYW5kLCB7IHVybCB9KTtcbiAgICB9XG5cbiAgICBfY2xvc2VXaW5kb3ckICh3aW5kb3cpIHtcbiAgICAgICAgY29uc3QgYXBpTWV0aG9kTmFtZSA9ICdjbG9zZVdpbmRvdyc7XG4gICAgICAgIGNvbnN0IHdpbmRvd0lkICAgICAgPSB3aW5kb3c/LmlkIHx8IG51bGw7XG5cbiAgICAgICAgdGhpcy5fdmFsaWRhdGVNdWx0aXBsZVdpbmRvd0NvbW1hbmQoYXBpTWV0aG9kTmFtZSk7XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuX2VucXVldWVDb21tYW5kKGFwaU1ldGhvZE5hbWUsIENsb3NlV2luZG93Q29tbWFuZCwgeyB3aW5kb3dJZCB9KTtcbiAgICB9XG5cbiAgICBfZ2V0Q3VycmVudFdpbmRvdyQgKCkge1xuICAgICAgICBjb25zdCBhcGlNZXRob2ROYW1lID0gJ2dldEN1cnJlbnRXaW5kb3cnO1xuXG4gICAgICAgIHRoaXMuX3ZhbGlkYXRlTXVsdGlwbGVXaW5kb3dDb21tYW5kKGFwaU1ldGhvZE5hbWUpO1xuXG4gICAgICAgIHJldHVybiB0aGlzLl9lbnF1ZXVlQ29tbWFuZChhcGlNZXRob2ROYW1lLCBHZXRDdXJyZW50V2luZG93Q29tbWFuZCk7XG4gICAgfVxuXG4gICAgX3N3aXRjaFRvV2luZG93JCAod2luZG93U2VsZWN0b3IpIHtcbiAgICAgICAgY29uc3QgYXBpTWV0aG9kTmFtZSA9ICdzd2l0Y2hUb1dpbmRvdyc7XG5cbiAgICAgICAgdGhpcy5fdmFsaWRhdGVNdWx0aXBsZVdpbmRvd0NvbW1hbmQoYXBpTWV0aG9kTmFtZSk7XG5cbiAgICAgICAgbGV0IGNvbW1hbmQ7XG4gICAgICAgIGxldCBhcmdzO1xuXG4gICAgICAgIGlmICh0eXBlb2Ygd2luZG93U2VsZWN0b3IgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIGNvbW1hbmQgPSBTd2l0Y2hUb1dpbmRvd0J5UHJlZGljYXRlQ29tbWFuZDtcblxuICAgICAgICAgICAgYXJncyA9IHsgZmluZFdpbmRvdzogd2luZG93U2VsZWN0b3IgfTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGNvbW1hbmQgPSBTd2l0Y2hUb1dpbmRvd0NvbW1hbmQ7XG5cbiAgICAgICAgICAgIGFyZ3MgPSB7IHdpbmRvd0lkOiB3aW5kb3dTZWxlY3Rvcj8uaWQgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLl9lbnF1ZXVlQ29tbWFuZChhcGlNZXRob2ROYW1lLCBjb21tYW5kLCBhcmdzKTtcbiAgICB9XG5cbiAgICBfc3dpdGNoVG9QYXJlbnRXaW5kb3ckICgpIHtcbiAgICAgICAgY29uc3QgYXBpTWV0aG9kTmFtZSA9ICdzd2l0Y2hUb1BhcmVudFdpbmRvdyc7XG5cbiAgICAgICAgdGhpcy5fdmFsaWRhdGVNdWx0aXBsZVdpbmRvd0NvbW1hbmQoYXBpTWV0aG9kTmFtZSk7XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuX2VucXVldWVDb21tYW5kKGFwaU1ldGhvZE5hbWUsIFN3aXRjaFRvUGFyZW50V2luZG93Q29tbWFuZCk7XG4gICAgfVxuXG4gICAgX3N3aXRjaFRvUHJldmlvdXNXaW5kb3ckICgpIHtcbiAgICAgICAgY29uc3QgYXBpTWV0aG9kTmFtZSA9ICdzd2l0Y2hUb1ByZXZpb3VzV2luZG93JztcblxuICAgICAgICB0aGlzLl92YWxpZGF0ZU11bHRpcGxlV2luZG93Q29tbWFuZChhcGlNZXRob2ROYW1lKTtcblxuICAgICAgICByZXR1cm4gdGhpcy5fZW5xdWV1ZUNvbW1hbmQoYXBpTWV0aG9kTmFtZSwgU3dpdGNoVG9QcmV2aW91c1dpbmRvd0NvbW1hbmQpO1xuICAgIH1cblxuICAgIF9ldmFsJCAoZm4sIG9wdGlvbnMpIHtcbiAgICAgICAgaWYgKCFpc051bGxPclVuZGVmaW5lZChvcHRpb25zKSlcbiAgICAgICAgICAgIG9wdGlvbnMgPSBhc3NpZ24oe30sIG9wdGlvbnMsIHsgYm91bmRUZXN0UnVuOiB0aGlzIH0pO1xuXG4gICAgICAgIGNvbnN0IGJ1aWxkZXIgID0gbmV3IENsaWVudEZ1bmN0aW9uQnVpbGRlcihmbiwgb3B0aW9ucywgeyBpbnN0YW50aWF0aW9uOiAnZXZhbCcsIGV4ZWN1dGlvbjogJ2V2YWwnIH0pO1xuICAgICAgICBjb25zdCBjbGllbnRGbiA9IGJ1aWxkZXIuZ2V0RnVuY3Rpb24oKTtcblxuICAgICAgICByZXR1cm4gY2xpZW50Rm4oKTtcbiAgICB9XG5cbiAgICBfc2V0TmF0aXZlRGlhbG9nSGFuZGxlciQgKGZuLCBvcHRpb25zKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9lbnF1ZXVlQ29tbWFuZCgnc2V0TmF0aXZlRGlhbG9nSGFuZGxlcicsIFNldE5hdGl2ZURpYWxvZ0hhbmRsZXJDb21tYW5kLCB7XG4gICAgICAgICAgICBkaWFsb2dIYW5kbGVyOiB7IGZuLCBvcHRpb25zIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgX2dldE5hdGl2ZURpYWxvZ0hpc3RvcnkkICgpIHtcbiAgICAgICAgY29uc3QgbmFtZSAgICAgPSAnZ2V0TmF0aXZlRGlhbG9nSGlzdG9yeSc7XG4gICAgICAgIGNvbnN0IGNhbGxzaXRlID0gZ2V0Q2FsbHNpdGVGb3JNZXRob2QobmFtZSk7XG5cbiAgICAgICAgcmV0dXJuIHRoaXMudGVzdFJ1bi5leGVjdXRlQWN0aW9uKG5hbWUsIG5ldyBHZXROYXRpdmVEaWFsb2dIaXN0b3J5Q29tbWFuZCgpLCBjYWxsc2l0ZSk7XG4gICAgfVxuXG4gICAgX2dldEJyb3dzZXJDb25zb2xlTWVzc2FnZXMkICgpIHtcbiAgICAgICAgY29uc3QgbmFtZSAgICAgPSAnZ2V0QnJvd3NlckNvbnNvbGVNZXNzYWdlcyc7XG4gICAgICAgIGNvbnN0IGNhbGxzaXRlID0gZ2V0Q2FsbHNpdGVGb3JNZXRob2QobmFtZSk7XG5cbiAgICAgICAgcmV0dXJuIHRoaXMudGVzdFJ1bi5leGVjdXRlQWN0aW9uKG5hbWUsIG5ldyBHZXRCcm93c2VyQ29uc29sZU1lc3NhZ2VzQ29tbWFuZCgpLCBjYWxsc2l0ZSk7XG4gICAgfVxuXG4gICAgX2NoZWNrRm9yRXhjZXNzaXZlQXdhaXRzIChzZWxlY3RvckNhbGxzaXRlTGlzdCwgZXhwZWN0Q2FsbHNpdGUpIHtcbiAgICAgICAgZm9yIChjb25zdCBzZWxlY3RvckNhbGxzaXRlIG9mIHNlbGVjdG9yQ2FsbHNpdGVMaXN0KSB7XG4gICAgICAgICAgICBpZiAoc2VsZWN0b3JDYWxsc2l0ZS5maWxlbmFtZSA9PT0gZXhwZWN0Q2FsbHNpdGUuZmlsZW5hbWUgJiZcbiAgICAgICAgICAgICAgICBzZWxlY3RvckNhbGxzaXRlLmxpbmVOdW0gPT09IGV4cGVjdENhbGxzaXRlLmxpbmVOdW0pIHtcbiAgICAgICAgICAgICAgICBhZGRXYXJuaW5nKHRoaXMud2FybmluZ0xvZywgV0FSTklOR19NRVNTQUdFLmV4Y2Vzc2l2ZUF3YWl0SW5Bc3NlcnRpb24sIHNlbGVjdG9yQ2FsbHNpdGUpO1xuXG4gICAgICAgICAgICAgICAgc2VsZWN0b3JDYWxsc2l0ZUxpc3QuZGVsZXRlKHNlbGVjdG9yQ2FsbHNpdGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgX2V4cGVjdCQgKGFjdHVhbCkge1xuICAgICAgICBjb25zdCBjYWxsc2l0ZSA9IGdldENhbGxzaXRlRm9yTWV0aG9kKCdleHBlY3QnKTtcblxuICAgICAgICB0aGlzLl9jaGVja0ZvckV4Y2Vzc2l2ZUF3YWl0cyh0aGlzLnRlc3RSdW4ub2JzZXJ2ZWRDYWxsc2l0ZXMuc25hcHNob3RQcm9wZXJ0eUNhbGxzaXRlcywgY2FsbHNpdGUpO1xuXG4gICAgICAgIGlmIChpc0NsaWVudEZ1bmN0aW9uKGFjdHVhbCkpXG4gICAgICAgICAgICBhZGRXYXJuaW5nKHRoaXMud2FybmluZ0xvZywgV0FSTklOR19NRVNTQUdFLmFzc2VydGVkQ2xpZW50RnVuY3Rpb25JbnN0YW5jZSwgY2FsbHNpdGUpO1xuICAgICAgICBlbHNlIGlmIChpc1NlbGVjdG9yKGFjdHVhbCkpXG4gICAgICAgICAgICBhZGRXYXJuaW5nKHRoaXMud2FybmluZ0xvZywgV0FSTklOR19NRVNTQUdFLmFzc2VydGVkU2VsZWN0b3JJbnN0YW5jZSwgY2FsbHNpdGUpO1xuXG4gICAgICAgIHJldHVybiBuZXcgQXNzZXJ0aW9uKGFjdHVhbCwgdGhpcywgY2FsbHNpdGUpO1xuICAgIH1cblxuICAgIF9kZWJ1ZyQgKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fZW5xdWV1ZUNvbW1hbmQoJ2RlYnVnJywgRGVidWdDb21tYW5kKTtcbiAgICB9XG5cbiAgICBfc2V0VGVzdFNwZWVkJCAoc3BlZWQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2VucXVldWVDb21tYW5kKCdzZXRUZXN0U3BlZWQnLCBTZXRUZXN0U3BlZWRDb21tYW5kLCB7IHNwZWVkIH0pO1xuICAgIH1cblxuICAgIF9zZXRQYWdlTG9hZFRpbWVvdXQkIChkdXJhdGlvbikge1xuICAgICAgICByZXR1cm4gdGhpcy5fZW5xdWV1ZUNvbW1hbmQoJ3NldFBhZ2VMb2FkVGltZW91dCcsIFNldFBhZ2VMb2FkVGltZW91dENvbW1hbmQsIHsgZHVyYXRpb24gfSk7XG4gICAgfVxuXG4gICAgX3VzZVJvbGUkIChyb2xlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9lbnF1ZXVlQ29tbWFuZCgndXNlUm9sZScsIFVzZVJvbGVDb21tYW5kLCB7IHJvbGUgfSk7XG4gICAgfVxuXG4gICAgX2FkZFJlcXVlc3RIb29rcyQgKC4uLmhvb2tzKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9lbnF1ZXVlVGFzaygnYWRkUmVxdWVzdEhvb2tzJywgKCkgPT4ge1xuICAgICAgICAgICAgaG9va3MgPSBmbGF0dGVuKGhvb2tzKTtcblxuICAgICAgICAgICAgYXNzZXJ0UmVxdWVzdEhvb2tUeXBlKGhvb2tzKTtcblxuICAgICAgICAgICAgaG9va3MuZm9yRWFjaChob29rID0+IHRoaXMudGVzdFJ1bi5hZGRSZXF1ZXN0SG9vayhob29rKSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIF9yZW1vdmVSZXF1ZXN0SG9va3MkICguLi5ob29rcykge1xuICAgICAgICByZXR1cm4gdGhpcy5fZW5xdWV1ZVRhc2soJ3JlbW92ZVJlcXVlc3RIb29rcycsICgpID0+IHtcbiAgICAgICAgICAgIGhvb2tzID0gZmxhdHRlbihob29rcyk7XG5cbiAgICAgICAgICAgIGFzc2VydFJlcXVlc3RIb29rVHlwZShob29rcyk7XG5cbiAgICAgICAgICAgIGhvb2tzLmZvckVhY2goaG9vayA9PiB0aGlzLnRlc3RSdW4ucmVtb3ZlUmVxdWVzdEhvb2soaG9vaykpO1xuICAgICAgICB9KTtcbiAgICB9XG59XG5cblRlc3RDb250cm9sbGVyLkFQSV9MSVNUID0gZ2V0RGVsZWdhdGVkQVBJTGlzdChUZXN0Q29udHJvbGxlci5wcm90b3R5cGUpO1xuXG5kZWxlZ2F0ZUFQSShUZXN0Q29udHJvbGxlci5wcm90b3R5cGUsIFRlc3RDb250cm9sbGVyLkFQSV9MSVNULCB7IHVzZUN1cnJlbnRDdHhBc0hhbmRsZXI6IHRydWUgfSk7XG4iXX0=