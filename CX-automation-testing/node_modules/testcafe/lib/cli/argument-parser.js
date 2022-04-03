"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const lodash_1 = require("lodash");
const commander_1 = require("commander");
const dedent_1 = __importDefault(require("dedent"));
const read_file_relative_1 = require("read-file-relative");
const runtime_1 = require("../errors/runtime");
const types_1 = require("../errors/types");
const type_assertions_1 = require("../errors/runtime/type-assertions");
const get_viewport_width_1 = __importDefault(require("../utils/get-viewport-width"));
const string_1 = require("../utils/string");
const get_options_1 = require("../utils/get-options");
const get_filter_fn_1 = __importDefault(require("../utils/get-filter-fn"));
const screenshot_option_names_1 = __importDefault(require("../configuration/screenshot-option-names"));
const run_option_names_1 = __importDefault(require("../configuration/run-option-names"));
const REMOTE_ALIAS_RE = /^remote(?::(\d*))?$/;
const DESCRIPTION = dedent_1.default(`
    In the browser list, you can use browser names (e.g. "ie", "chrome", etc.) as well as paths to executables.

    To run tests against all installed browsers, use the "all" alias.

    To use a remote browser connection (e.g., to connect a mobile device), specify "remote" as the browser alias.
    If you need to connect multiple devices, add a colon and the number of browsers you want to connect (e.g., "remote:3").

    To run tests in a browser accessed through a browser provider plugin, specify a browser alias that consists of two parts - the browser provider name prefix and the name of the browser itself; for example, "saucelabs:chrome@51".

    You can use one or more file paths or glob patterns to specify which tests to run.

    More info: https://devexpress.github.io/testcafe/documentation
`);
class CLIArgumentParser {
    constructor(cwd) {
        this.program = new commander_1.Command('testcafe');
        this.experimental = new commander_1.Command('testcafe-experimental');
        this.cwd = cwd || process.cwd();
        this.remoteCount = 0;
        this.opts = {};
        this.args = [];
        this._describeProgram();
    }
    static _parsePortNumber(value) {
        type_assertions_1.assertType(type_assertions_1.is.nonNegativeNumberString, null, 'Port number', value);
        return parseInt(value, 10);
    }
    static _getDescription() {
        // NOTE: add empty line to workaround commander-forced indentation on the first line.
        return '\n' + string_1.wordWrap(DESCRIPTION, 2, get_viewport_width_1.default(process.stdout));
    }
    _describeProgram() {
        const version = JSON.parse(read_file_relative_1.readSync('../../package.json')).version;
        this.program
            .version(version, '-v, --version')
            .usage('[options] <comma-separated-browser-list> <file-or-glob ...>')
            .description(CLIArgumentParser._getDescription())
            .option('-b, --list-browsers [provider]', 'output the aliases for local browsers or browsers available through the specified browser provider')
            .option('-r, --reporter <name[:outputFile][,...]>', 'specify the reporters and optionally files where reports are saved')
            .option('-s, --screenshots <option=value[,...]>', 'specify screenshot options')
            .option('-S, --screenshots-on-fails', 'take a screenshot whenever a test fails')
            .option('-p, --screenshot-path-pattern <pattern>', 'use patterns to compose screenshot file names and paths: ${BROWSER}, ${BROWSER_VERSION}, ${OS}, etc.')
            .option('-q, --quarantine-mode', 'enable the quarantine mode')
            .option('-d, --debug-mode', 'execute test steps one by one pausing the test after each step')
            .option('-e, --skip-js-errors', 'make tests not fail when a JS error happens on a page')
            .option('-u, --skip-uncaught-errors', 'ignore uncaught errors and unhandled promise rejections, which occur during test execution')
            .option('-t, --test <name>', 'run only tests with the specified name')
            .option('-T, --test-grep <pattern>', 'run only tests matching the specified pattern')
            .option('-f, --fixture <name>', 'run only fixtures with the specified name')
            .option('-F, --fixture-grep <pattern>', 'run only fixtures matching the specified pattern')
            .option('-a, --app <command>', 'launch the tested app using the specified command before running tests')
            .option('-c, --concurrency <number>', 'run tests concurrently')
            .option('-L, --live', 'enable live mode. In this mode, TestCafe watches for changes you make in the test files. These changes immediately restart the tests so that you can see the effect.')
            .option('--test-meta <key=value[,key2=value2,...]>', 'run only tests with matching metadata')
            .option('--fixture-meta <key=value[,key2=value2,...]>', 'run only fixtures with matching metadata')
            .option('--debug-on-fail', 'pause the test if it fails')
            .option('--app-init-delay <ms>', 'specify how much time it takes for the tested app to initialize')
            .option('--selector-timeout <ms>', 'specify the time within which selectors make attempts to obtain a node to be returned')
            .option('--assertion-timeout <ms>', 'specify the time within which assertion should pass')
            .option('--page-load-timeout <ms>', 'specify the time within which TestCafe waits for the `window.load` event to fire on page load before proceeding to the next test action')
            .option('--speed <factor>', 'set the speed of test execution (0.01 ... 1)')
            .option('--ports <port1,port2>', 'specify custom port numbers')
            .option('--hostname <name>', 'specify the hostname')
            .option('--proxy <host>', 'specify the host of the proxy server')
            .option('--proxy-bypass <rules>', 'specify a comma-separated list of rules that define URLs accessed bypassing the proxy server')
            .option('--ssl <options>', 'specify SSL options to run TestCafe proxy server over the HTTPS protocol')
            .option('--video <path>', 'record videos of test runs')
            .option('--video-options <option=value[,...]>', 'specify video recording options')
            .option('--video-encoding-options <option=value[,...]>', 'specify encoding options')
            .option('--dev', 'enables mechanisms to log and diagnose errors')
            .option('--qr-code', 'outputs QR-code that repeats URLs used to connect the remote browsers')
            .option('--sf, --stop-on-first-fail', 'stop an entire test run if any test fails')
            .option('--ts-config-path <path>', 'use a custom TypeScript configuration file and specify its location')
            .option('--cs, --client-scripts <paths>', 'inject scripts into tested pages', this._parseList, [])
            .option('--disable-page-caching', 'disable page caching during test execution')
            .option('--disable-page-reloads', 'disable page reloads between tests')
            .option('--disable-screenshots', 'disable screenshots')
            .option('--screenshots-full-page', 'enable full-page screenshots')
            // NOTE: these options will be handled by chalk internally
            .option('--color', 'force colors in command line')
            .option('--no-color', 'disable colors in command line');
        // NOTE: temporary hide experimental options from --help command
        this.experimental
            .allowUnknownOption()
            .option('--disable-multiple-windows', 'disable multiple windows mode')
            .option('--experimental-compiler-service', 'run compiler in a separate process');
    }
    _parseList(val) {
        return val.split(',');
    }
    _checkAndCountRemotes(browser) {
        const remoteMatch = browser.match(REMOTE_ALIAS_RE);
        if (remoteMatch) {
            this.remoteCount += parseInt(remoteMatch[1], 10) || 1;
            return false;
        }
        return true;
    }
    async _parseFilteringOptions() {
        if (this.opts.testGrep)
            this.opts.testGrep = get_options_1.getGrepOptions('--test-grep', this.opts.testGrep);
        if (this.opts.fixtureGrep)
            this.opts.fixtureGrep = get_options_1.getGrepOptions('--fixture-grep', this.opts.fixtureGrep);
        if (this.opts.testMeta)
            this.opts.testMeta = await get_options_1.getMetaOptions('--test-meta', this.opts.testMeta);
        if (this.opts.fixtureMeta)
            this.opts.fixtureMeta = await get_options_1.getMetaOptions('--fixture-meta', this.opts.fixtureMeta);
        this.opts.filter = get_filter_fn_1.default(this.opts);
    }
    _parseAppInitDelay() {
        if (this.opts.appInitDelay) {
            type_assertions_1.assertType(type_assertions_1.is.nonNegativeNumberString, null, 'Tested app initialization delay', this.opts.appInitDelay);
            this.opts.appInitDelay = parseInt(this.opts.appInitDelay, 10);
        }
    }
    _parseSelectorTimeout() {
        if (this.opts.selectorTimeout) {
            type_assertions_1.assertType(type_assertions_1.is.nonNegativeNumberString, null, 'Selector timeout', this.opts.selectorTimeout);
            this.opts.selectorTimeout = parseInt(this.opts.selectorTimeout, 10);
        }
    }
    _parseAssertionTimeout() {
        if (this.opts.assertionTimeout) {
            type_assertions_1.assertType(type_assertions_1.is.nonNegativeNumberString, null, 'Assertion timeout', this.opts.assertionTimeout);
            this.opts.assertionTimeout = parseInt(this.opts.assertionTimeout, 10);
        }
    }
    _parsePageLoadTimeout() {
        if (this.opts.pageLoadTimeout) {
            type_assertions_1.assertType(type_assertions_1.is.nonNegativeNumberString, null, 'Page load timeout', this.opts.pageLoadTimeout);
            this.opts.pageLoadTimeout = parseInt(this.opts.pageLoadTimeout, 10);
        }
    }
    _parseSpeed() {
        if (this.opts.speed)
            this.opts.speed = parseFloat(this.opts.speed);
    }
    _parseConcurrency() {
        if (this.opts.concurrency)
            this.opts.concurrency = parseInt(this.opts.concurrency, 10);
    }
    _parsePorts() {
        if (this.opts.ports) {
            const parsedPorts = this.opts.ports /* eslint-disable-line no-extra-parens */
                .split(',')
                .map(CLIArgumentParser._parsePortNumber);
            if (parsedPorts.length < 2)
                throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.portsOptionRequiresTwoNumbers);
            this.opts.ports = parsedPorts;
        }
    }
    _parseBrowsersFromArgs() {
        const browsersArg = this.program.args[0] || '';
        this.opts.browsers = string_1.splitQuotedText(browsersArg, ',')
            .filter(browser => browser && this._checkAndCountRemotes(browser));
    }
    async _parseSslOptions() {
        if (this.opts.ssl)
            this.opts.ssl = await get_options_1.getSSLOptions(this.opts.ssl);
    }
    async _parseReporters() {
        const reporters = this.opts.reporter ? this.opts.reporter.split(',') : []; /* eslint-disable-line no-extra-parens*/
        this.opts.reporter = reporters.map((reporter) => {
            const separatorIndex = reporter.indexOf(':');
            if (separatorIndex < 0)
                return { name: reporter };
            const name = reporter.substring(0, separatorIndex);
            const output = reporter.substring(separatorIndex + 1);
            return { name, output };
        });
    }
    _parseFileList() {
        this.opts.src = this.program.args.slice(1);
    }
    async _parseScreenshotOptions() {
        if (this.opts.screenshots)
            this.opts.screenshots = await get_options_1.getScreenshotOptions(this.opts.screenshots);
        else
            this.opts.screenshots = {};
        if (!lodash_1.has(this.opts.screenshots, screenshot_option_names_1.default.pathPattern) && this.opts.screenshotPathPattern)
            this.opts.screenshots[screenshot_option_names_1.default.pathPattern] = this.opts.screenshotPathPattern;
        if (!lodash_1.has(this.opts.screenshots, screenshot_option_names_1.default.takeOnFails) && this.opts.screenshotsOnFails)
            this.opts.screenshots[screenshot_option_names_1.default.takeOnFails] = this.opts.screenshotsOnFails;
    }
    async _parseVideoOptions() {
        if (this.opts.videoOptions)
            this.opts.videoOptions = await get_options_1.getVideoOptions(this.opts.videoOptions);
        if (this.opts.videoEncodingOptions)
            this.opts.videoEncodingOptions = await get_options_1.getVideoOptions(this.opts.videoEncodingOptions);
    }
    _parseListBrowsers() {
        const listBrowserOption = this.opts.listBrowsers;
        this.opts.listBrowsers = !!this.opts.listBrowsers;
        if (!this.opts.listBrowsers)
            return;
        this.opts.providerName = typeof listBrowserOption === 'string' ? listBrowserOption : 'locally-installed';
    }
    async parse(argv) {
        this.program.parse(argv);
        this.experimental.parse(argv);
        this.args = this.program.args;
        this.opts = Object.assign(Object.assign({}, this.experimental.opts()), this.program.opts());
        this._parseListBrowsers();
        // NOTE: the '--list-browsers' option only lists browsers and immediately exits the app.
        // Therefore, we don't need to process other arguments.
        if (this.opts.listBrowsers)
            return;
        this._parseSelectorTimeout();
        this._parseAssertionTimeout();
        this._parsePageLoadTimeout();
        this._parseAppInitDelay();
        this._parseSpeed();
        this._parsePorts();
        this._parseBrowsersFromArgs();
        this._parseConcurrency();
        this._parseFileList();
        await this._parseFilteringOptions();
        await this._parseScreenshotOptions();
        await this._parseVideoOptions();
        await this._parseSslOptions();
        await this._parseReporters();
    }
    getRunOptions() {
        const result = Object.create(null);
        run_option_names_1.default.forEach(optionName => {
            if (optionName in this.opts)
                // @ts-ignore a hack to add an index signature to interface
                result[optionName] = this.opts[optionName];
        });
        return result;
    }
}
exports.default = CLIArgumentParser;
module.exports = exports.default;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXJndW1lbnQtcGFyc2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2NsaS9hcmd1bWVudC1wYXJzZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSxtQ0FBNkI7QUFDN0IseUNBQW9DO0FBQ3BDLG9EQUE0QjtBQUM1QiwyREFBc0Q7QUFDdEQsK0NBQWlEO0FBQ2pELDJDQUFpRDtBQUNqRCx1RUFBbUU7QUFDbkUscUZBQTJEO0FBQzNELDRDQUE0RDtBQUM1RCxzREFNOEI7QUFFOUIsMkVBQWlEO0FBQ2pELHVHQUErRTtBQUMvRSx5RkFBaUU7QUFRakUsTUFBTSxlQUFlLEdBQUcscUJBQXFCLENBQUM7QUFFOUMsTUFBTSxXQUFXLEdBQUcsZ0JBQU0sQ0FBQzs7Ozs7Ozs7Ozs7OztDQWExQixDQUFDLENBQUM7QUE0QkgsTUFBcUIsaUJBQWlCO0lBUWxDLFlBQW9CLEdBQVc7UUFDM0IsSUFBSSxDQUFDLE9BQU8sR0FBUSxJQUFJLG1CQUFPLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDNUMsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFJLG1CQUFPLENBQUMsdUJBQXVCLENBQUMsQ0FBQztRQUN6RCxJQUFJLENBQUMsR0FBRyxHQUFZLEdBQUcsSUFBSSxPQUFPLENBQUMsR0FBRyxFQUFFLENBQUM7UUFDekMsSUFBSSxDQUFDLFdBQVcsR0FBSSxDQUFDLENBQUM7UUFDdEIsSUFBSSxDQUFDLElBQUksR0FBVyxFQUFFLENBQUM7UUFDdkIsSUFBSSxDQUFDLElBQUksR0FBVyxFQUFFLENBQUM7UUFFdkIsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUM7SUFDNUIsQ0FBQztJQUVPLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBRSxLQUFhO1FBQzFDLDRCQUFVLENBQUMsb0JBQUUsQ0FBQyx1QkFBdUIsRUFBRSxJQUFJLEVBQUUsYUFBYSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRW5FLE9BQU8sUUFBUSxDQUFDLEtBQUssRUFBRSxFQUFF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QUFhO1FBQ2hCLE1BQU0sTUFBTSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7UUFFbkMsMEJBQWdCLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxFQUFFO1lBQ2xDLElBQUksVUFBVSxJQUFJLElBQUksQ0FBQyxJQUFJO2dCQUN2QiwyREFBMkQ7Z0JBQzNELE1BQU0sQ0FBQyxVQUFVLENBQUMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ25ELENBQUMsQ0FBQyxDQUFDO1FBRUgsT0FBTyxNQUEwQixDQUFDO0lBQ3RDLENBQUM7Q0FDSjtBQTdSRCxvQ0E2UkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBoYXMgfSBmcm9tICdsb2Rhc2gnO1xuaW1wb3J0IHsgQ29tbWFuZCB9IGZyb20gJ2NvbW1hbmRlcic7XG5pbXBvcnQgZGVkZW50IGZyb20gJ2RlZGVudCc7XG5pbXBvcnQgeyByZWFkU3luYyBhcyByZWFkIH0gZnJvbSAncmVhZC1maWxlLXJlbGF0aXZlJztcbmltcG9ydCB7IEdlbmVyYWxFcnJvciB9IGZyb20gJy4uL2Vycm9ycy9ydW50aW1lJztcbmltcG9ydCB7IFJVTlRJTUVfRVJST1JTIH0gZnJvbSAnLi4vZXJyb3JzL3R5cGVzJztcbmltcG9ydCB7IGFzc2VydFR5cGUsIGlzIH0gZnJvbSAnLi4vZXJyb3JzL3J1bnRpbWUvdHlwZS1hc3NlcnRpb25zJztcbmltcG9ydCBnZXRWaWV3UG9ydFdpZHRoIGZyb20gJy4uL3V0aWxzL2dldC12aWV3cG9ydC13aWR0aCc7XG5pbXBvcnQgeyB3b3JkV3JhcCwgc3BsaXRRdW90ZWRUZXh0IH0gZnJvbSAnLi4vdXRpbHMvc3RyaW5nJztcbmltcG9ydCB7XG4gICAgZ2V0U1NMT3B0aW9ucyxcbiAgICBnZXRTY3JlZW5zaG90T3B0aW9ucyxcbiAgICBnZXRWaWRlb09wdGlvbnMsXG4gICAgZ2V0TWV0YU9wdGlvbnMsXG4gICAgZ2V0R3JlcE9wdGlvbnNcbn0gZnJvbSAnLi4vdXRpbHMvZ2V0LW9wdGlvbnMnO1xuXG5pbXBvcnQgZ2V0RmlsdGVyRm4gZnJvbSAnLi4vdXRpbHMvZ2V0LWZpbHRlci1mbic7XG5pbXBvcnQgU0NSRUVOU0hPVF9PUFRJT05fTkFNRVMgZnJvbSAnLi4vY29uZmlndXJhdGlvbi9zY3JlZW5zaG90LW9wdGlvbi1uYW1lcyc7XG5pbXBvcnQgUlVOX09QVElPTl9OQU1FUyBmcm9tICcuLi9jb25maWd1cmF0aW9uL3J1bi1vcHRpb24tbmFtZXMnO1xuaW1wb3J0IHtcbiAgICBEaWN0aW9uYXJ5LFxuICAgIFJlcG9ydGVyT3B0aW9uLFxuICAgIFJ1bm5lclJ1bk9wdGlvbnNcbn0gZnJvbSAnLi4vY29uZmlndXJhdGlvbi9pbnRlcmZhY2VzJztcblxuXG5jb25zdCBSRU1PVEVfQUxJQVNfUkUgPSAvXnJlbW90ZSg/OjooXFxkKikpPyQvO1xuXG5jb25zdCBERVNDUklQVElPTiA9IGRlZGVudChgXG4gICAgSW4gdGhlIGJyb3dzZXIgbGlzdCwgeW91IGNhbiB1c2UgYnJvd3NlciBuYW1lcyAoZS5nLiBcImllXCIsIFwiY2hyb21lXCIsIGV0Yy4pIGFzIHdlbGwgYXMgcGF0aHMgdG8gZXhlY3V0YWJsZXMuXG5cbiAgICBUbyBydW4gdGVzdHMgYWdhaW5zdCBhbGwgaW5zdGFsbGVkIGJyb3dzZXJzLCB1c2UgdGhlIFwiYWxsXCIgYWxpYXMuXG5cbiAgICBUbyB1c2UgYSByZW1vdGUgYnJvd3NlciBjb25uZWN0aW9uIChlLmcuLCB0byBjb25uZWN0IGEgbW9iaWxlIGRldmljZSksIHNwZWNpZnkgXCJyZW1vdGVcIiBhcyB0aGUgYnJvd3NlciBhbGlhcy5cbiAgICBJZiB5b3UgbmVlZCB0byBjb25uZWN0IG11bHRpcGxlIGRldmljZXMsIGFkZCBhIGNvbG9uIGFuZCB0aGUgbnVtYmVyIG9mIGJyb3dzZXJzIHlvdSB3YW50IHRvIGNvbm5lY3QgKGUuZy4sIFwicmVtb3RlOjNcIikuXG5cbiAgICBUbyBydW4gdGVzdHMgaW4gYSBicm93c2VyIGFjY2Vzc2VkIHRocm91Z2ggYSBicm93c2VyIHByb3ZpZGVyIHBsdWdpbiwgc3BlY2lmeSBhIGJyb3dzZXIgYWxpYXMgdGhhdCBjb25zaXN0cyBvZiB0d28gcGFydHMgLSB0aGUgYnJvd3NlciBwcm92aWRlciBuYW1lIHByZWZpeCBhbmQgdGhlIG5hbWUgb2YgdGhlIGJyb3dzZXIgaXRzZWxmOyBmb3IgZXhhbXBsZSwgXCJzYXVjZWxhYnM6Y2hyb21lQDUxXCIuXG5cbiAgICBZb3UgY2FuIHVzZSBvbmUgb3IgbW9yZSBmaWxlIHBhdGhzIG9yIGdsb2IgcGF0dGVybnMgdG8gc3BlY2lmeSB3aGljaCB0ZXN0cyB0byBydW4uXG5cbiAgICBNb3JlIGluZm86IGh0dHBzOi8vZGV2ZXhwcmVzcy5naXRodWIuaW8vdGVzdGNhZmUvZG9jdW1lbnRhdGlvblxuYCk7XG5cbmludGVyZmFjZSBDb21tYW5kTGluZU9wdGlvbnMge1xuICAgIHRlc3RHcmVwPzogc3RyaW5nIHwgUmVnRXhwO1xuICAgIGZpeHR1cmVHcmVwPzogc3RyaW5nIHwgUmVnRXhwO1xuICAgIHNyYz86IHN0cmluZ1tdO1xuICAgIGJyb3dzZXJzPzogc3RyaW5nW107XG4gICAgbGlzdEJyb3dzZXJzPzogYm9vbGVhbiB8IHN0cmluZztcbiAgICB0ZXN0TWV0YT86IHN0cmluZyB8IERpY3Rpb25hcnk8c3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbj47XG4gICAgZml4dHVyZU1ldGE/OiBzdHJpbmcgfCBEaWN0aW9uYXJ5PHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4+O1xuICAgIGZpbHRlcj86IEZ1bmN0aW9uO1xuICAgIGFwcEluaXREZWxheT86IHN0cmluZyB8IG51bWJlcjtcbiAgICBhc3NlcnRpb25UaW1lb3V0Pzogc3RyaW5nIHwgbnVtYmVyO1xuICAgIHNlbGVjdG9yVGltZW91dD86IHN0cmluZyB8IG51bWJlcjtcbiAgICBzcGVlZD86IHN0cmluZyB8IG51bWJlcjtcbiAgICBwYWdlTG9hZFRpbWVvdXQ/OiBzdHJpbmcgfCBudW1iZXI7XG4gICAgY29uY3VycmVuY3k/OiBzdHJpbmcgfCBudW1iZXI7XG4gICAgcG9ydHM/OiBzdHJpbmcgfCBudW1iZXJbXTtcbiAgICBwcm92aWRlck5hbWU/OiBzdHJpbmc7XG4gICAgc3NsPzogc3RyaW5nIHwgRGljdGlvbmFyeTxzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuID47XG4gICAgcmVwb3J0ZXI/OiBzdHJpbmcgfCBSZXBvcnRlck9wdGlvbltdO1xuICAgIHNjcmVlbnNob3RzPzogRGljdGlvbmFyeTxzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuPiB8IHN0cmluZztcbiAgICBzY3JlZW5zaG90UGF0aFBhdHRlcm4/OiBzdHJpbmc7XG4gICAgc2NyZWVuc2hvdHNPbkZhaWxzPzogYm9vbGVhbjtcbiAgICB2aWRlb09wdGlvbnM/OiBzdHJpbmcgfCBEaWN0aW9uYXJ5PG51bWJlciB8IHN0cmluZyB8IGJvb2xlYW4+O1xuICAgIHZpZGVvRW5jb2RpbmdPcHRpb25zPzogc3RyaW5nIHwgRGljdGlvbmFyeTxudW1iZXIgfCBzdHJpbmcgfCBib29sZWFuPjtcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQ0xJQXJndW1lbnRQYXJzZXIge1xuICAgIHByaXZhdGUgcmVhZG9ubHkgcHJvZ3JhbTogQ29tbWFuZDtcbiAgICBwcml2YXRlIHJlYWRvbmx5IGV4cGVyaW1lbnRhbDogQ29tbWFuZDtcbiAgICBwcml2YXRlIGN3ZDogc3RyaW5nO1xuICAgIHByaXZhdGUgcmVtb3RlQ291bnQ6IG51bWJlcjtcbiAgICBwdWJsaWMgb3B0czogQ29tbWFuZExpbmVPcHRpb25zO1xuICAgIHB1YmxpYyBhcmdzOiBzdHJpbmdbXTtcblxuICAgIHB1YmxpYyBjb25zdHJ1Y3RvciAoY3dkOiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5wcm9ncmFtICAgICAgPSBuZXcgQ29tbWFuZCgndGVzdGNhZmUnKTtcbiAgICAgICAgdGhpcy5leHBlcmltZW50YWwgPSBuZXcgQ29tbWFuZCgndGVzdGNhZmUtZXhwZXJpbWVudGFsJyk7XG4gICAgICAgIHRoaXMuY3dkICAgICAgICAgID0gY3dkIHx8IHByb2Nlc3MuY3dkKCk7XG4gICAgICAgIHRoaXMucmVtb3RlQ291bnQgID0gMDtcbiAgICAgICAgdGhpcy5vcHRzICAgICAgICAgPSB7fTtcbiAgICAgICAgdGhpcy5hcmdzICAgICAgICAgPSBbXTtcblxuICAgICAgICB0aGlzLl9kZXNjcmliZVByb2dyYW0oKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHN0YXRpYyBfcGFyc2VQb3J0TnVtYmVyICh2YWx1ZTogc3RyaW5nKTogbnVtYmVyIHtcbiAgICAgICAgYXNzZXJ0VHlwZShpcy5ub25OZWdhdGl2ZU51bWJlclN0cmluZywgbnVsbCwgJ1BvcnQgbnVtYmVyJywgdmFsdWUpO1xuXG4gICAgICAgIHJldHVybiBwYXJzZUludCh2YWx1ZSwgMTApO1xuICAgIH1cblxuICAgIHByaXZhdGUgc3RhdGljIF9nZXREZXNjcmlwdGlvbiAoKTogc3RyaW5nIHtcbiAgICAgICAgLy8gTk9URTogYWRkIGVtcHR5IGxpbmUgdG8gd29ya2Fyb3VuZCBjb21tYW5kZXItZm9yY2VkIGluZGVudGF0aW9uIG9uIHRoZSBmaXJzdCBsaW5lLlxuICAgICAgICByZXR1cm4gJ1xcbicgKyB3b3JkV3JhcChERVNDUklQVElPTiwgMiwgZ2V0Vmlld1BvcnRXaWR0aChwcm9jZXNzLnN0ZG91dCkpO1xuICAgIH1cblxuICAgIHByaXZhdGUgX2Rlc2NyaWJlUHJvZ3JhbSAoKTogdm9pZCB7XG4gICAgICAgIGNvbnN0IHZlcnNpb24gPSBKU09OLnBhcnNlKHJlYWQoJy4uLy4uL3BhY2thZ2UuanNvbicpIGFzIHN0cmluZykudmVyc2lvbjtcblxuICAgICAgICB0aGlzLnByb2dyYW1cbiAgICAgICAgICAgIC52ZXJzaW9uKHZlcnNpb24sICctdiwgLS12ZXJzaW9uJylcbiAgICAgICAgICAgIC51c2FnZSgnW29wdGlvbnNdIDxjb21tYS1zZXBhcmF0ZWQtYnJvd3Nlci1saXN0PiA8ZmlsZS1vci1nbG9iIC4uLj4nKVxuICAgICAgICAgICAgLmRlc2NyaXB0aW9uKENMSUFyZ3VtZW50UGFyc2VyLl9nZXREZXNjcmlwdGlvbigpKVxuXG4gICAgICAgICAgICAub3B0aW9uKCctYiwgLS1saXN0LWJyb3dzZXJzIFtwcm92aWRlcl0nLCAnb3V0cHV0IHRoZSBhbGlhc2VzIGZvciBsb2NhbCBicm93c2VycyBvciBicm93c2VycyBhdmFpbGFibGUgdGhyb3VnaCB0aGUgc3BlY2lmaWVkIGJyb3dzZXIgcHJvdmlkZXInKVxuICAgICAgICAgICAgLm9wdGlvbignLXIsIC0tcmVwb3J0ZXIgPG5hbWVbOm91dHB1dEZpbGVdWywuLi5dPicsICdzcGVjaWZ5IHRoZSByZXBvcnRlcnMgYW5kIG9wdGlvbmFsbHkgZmlsZXMgd2hlcmUgcmVwb3J0cyBhcmUgc2F2ZWQnKVxuICAgICAgICAgICAgLm9wdGlvbignLXMsIC0tc2NyZWVuc2hvdHMgPG9wdGlvbj12YWx1ZVssLi4uXT4nLCAnc3BlY2lmeSBzY3JlZW5zaG90IG9wdGlvbnMnKVxuICAgICAgICAgICAgLm9wdGlvbignLVMsIC0tc2NyZWVuc2hvdHMtb24tZmFpbHMnLCAndGFrZSBhIHNjcmVlbnNob3Qgd2hlbmV2ZXIgYSB0ZXN0IGZhaWxzJylcbiAgICAgICAgICAgIC5vcHRpb24oJy1wLCAtLXNjcmVlbnNob3QtcGF0aC1wYXR0ZXJuIDxwYXR0ZXJuPicsICd1c2UgcGF0dGVybnMgdG8gY29tcG9zZSBzY3JlZW5zaG90IGZpbGUgbmFtZXMgYW5kIHBhdGhzOiAke0JST1dTRVJ9LCAke0JST1dTRVJfVkVSU0lPTn0sICR7T1N9LCBldGMuJylcbiAgICAgICAgICAgIC5vcHRpb24oJy1xLCAtLXF1YXJhbnRpbmUtbW9kZScsICdlbmFibGUgdGhlIHF1YXJhbnRpbmUgbW9kZScpXG4gICAgICAgICAgICAub3B0aW9uKCctZCwgLS1kZWJ1Zy1tb2RlJywgJ2V4ZWN1dGUgdGVzdCBzdGVwcyBvbmUgYnkgb25lIHBhdXNpbmcgdGhlIHRlc3QgYWZ0ZXIgZWFjaCBzdGVwJylcbiAgICAgICAgICAgIC5vcHRpb24oJy1lLCAtLXNraXAtanMtZXJyb3JzJywgJ21ha2UgdGVzdHMgbm90IGZhaWwgd2hlbiBhIEpTIGVycm9yIGhhcHBlbnMgb24gYSBwYWdlJylcbiAgICAgICAgICAgIC5vcHRpb24oJy11LCAtLXNraXAtdW5jYXVnaHQtZXJyb3JzJywgJ2lnbm9yZSB1bmNhdWdodCBlcnJvcnMgYW5kIHVuaGFuZGxlZCBwcm9taXNlIHJlamVjdGlvbnMsIHdoaWNoIG9jY3VyIGR1cmluZyB0ZXN0IGV4ZWN1dGlvbicpXG4gICAgICAgICAgICAub3B0aW9uKCctdCwgLS10ZXN0IDxuYW1lPicsICdydW4gb25seSB0ZXN0cyB3aXRoIHRoZSBzcGVjaWZpZWQgbmFtZScpXG4gICAgICAgICAgICAub3B0aW9uKCctVCwgLS10ZXN0LWdyZXAgPHBhdHRlcm4+JywgJ3J1biBvbmx5IHRlc3RzIG1hdGNoaW5nIHRoZSBzcGVjaWZpZWQgcGF0dGVybicpXG4gICAgICAgICAgICAub3B0aW9uKCctZiwgLS1maXh0dXJlIDxuYW1lPicsICdydW4gb25seSBmaXh0dXJlcyB3aXRoIHRoZSBzcGVjaWZpZWQgbmFtZScpXG4gICAgICAgICAgICAub3B0aW9uKCctRiwgLS1maXh0dXJlLWdyZXAgPHBhdHRlcm4+JywgJ3J1biBvbmx5IGZpeHR1cmVzIG1hdGNoaW5nIHRoZSBzcGVjaWZpZWQgcGF0dGVybicpXG4gICAgICAgICAgICAub3B0aW9uKCctYSwgLS1hcHAgPGNvbW1hbmQ+JywgJ2xhdW5jaCB0aGUgdGVzdGVkIGFwcCB1c2luZyB0aGUgc3BlY2lmaWVkIGNvbW1hbmQgYmVmb3JlIHJ1bm5pbmcgdGVzdHMnKVxuICAgICAgICAgICAgLm9wdGlvbignLWMsIC0tY29uY3VycmVuY3kgPG51bWJlcj4nLCAncnVuIHRlc3RzIGNvbmN1cnJlbnRseScpXG4gICAgICAgICAgICAub3B0aW9uKCctTCwgLS1saXZlJywgJ2VuYWJsZSBsaXZlIG1vZGUuIEluIHRoaXMgbW9kZSwgVGVzdENhZmUgd2F0Y2hlcyBmb3IgY2hhbmdlcyB5b3UgbWFrZSBpbiB0aGUgdGVzdCBmaWxlcy4gVGhlc2UgY2hhbmdlcyBpbW1lZGlhdGVseSByZXN0YXJ0IHRoZSB0ZXN0cyBzbyB0aGF0IHlvdSBjYW4gc2VlIHRoZSBlZmZlY3QuJylcbiAgICAgICAgICAgIC5vcHRpb24oJy0tdGVzdC1tZXRhIDxrZXk9dmFsdWVbLGtleTI9dmFsdWUyLC4uLl0+JywgJ3J1biBvbmx5IHRlc3RzIHdpdGggbWF0Y2hpbmcgbWV0YWRhdGEnKVxuICAgICAgICAgICAgLm9wdGlvbignLS1maXh0dXJlLW1ldGEgPGtleT12YWx1ZVssa2V5Mj12YWx1ZTIsLi4uXT4nLCAncnVuIG9ubHkgZml4dHVyZXMgd2l0aCBtYXRjaGluZyBtZXRhZGF0YScpXG4gICAgICAgICAgICAub3B0aW9uKCctLWRlYnVnLW9uLWZhaWwnLCAncGF1c2UgdGhlIHRlc3QgaWYgaXQgZmFpbHMnKVxuICAgICAgICAgICAgLm9wdGlvbignLS1hcHAtaW5pdC1kZWxheSA8bXM+JywgJ3NwZWNpZnkgaG93IG11Y2ggdGltZSBpdCB0YWtlcyBmb3IgdGhlIHRlc3RlZCBhcHAgdG8gaW5pdGlhbGl6ZScpXG4gICAgICAgICAgICAub3B0aW9uKCctLXNlbGVjdG9yLXRpbWVvdXQgPG1zPicsICdzcGVjaWZ5IHRoZSB0aW1lIHdpdGhpbiB3aGljaCBzZWxlY3RvcnMgbWFrZSBhdHRlbXB0cyB0byBvYnRhaW4gYSBub2RlIHRvIGJlIHJldHVybmVkJylcbiAgICAgICAgICAgIC5vcHRpb24oJy0tYXNzZXJ0aW9uLXRpbWVvdXQgPG1zPicsICdzcGVjaWZ5IHRoZSB0aW1lIHdpdGhpbiB3aGljaCBhc3NlcnRpb24gc2hvdWxkIHBhc3MnKVxuICAgICAgICAgICAgLm9wdGlvbignLS1wYWdlLWxvYWQtdGltZW91dCA8bXM+JywgJ3NwZWNpZnkgdGhlIHRpbWUgd2l0aGluIHdoaWNoIFRlc3RDYWZlIHdhaXRzIGZvciB0aGUgYHdpbmRvdy5sb2FkYCBldmVudCB0byBmaXJlIG9uIHBhZ2UgbG9hZCBiZWZvcmUgcHJvY2VlZGluZyB0byB0aGUgbmV4dCB0ZXN0IGFjdGlvbicpXG4gICAgICAgICAgICAub3B0aW9uKCctLXNwZWVkIDxmYWN0b3I+JywgJ3NldCB0aGUgc3BlZWQgb2YgdGVzdCBleGVjdXRpb24gKDAuMDEgLi4uIDEpJylcbiAgICAgICAgICAgIC5vcHRpb24oJy0tcG9ydHMgPHBvcnQxLHBvcnQyPicsICdzcGVjaWZ5IGN1c3RvbSBwb3J0IG51bWJlcnMnKVxuICAgICAgICAgICAgLm9wdGlvbignLS1ob3N0bmFtZSA8bmFtZT4nLCAnc3BlY2lmeSB0aGUgaG9zdG5hbWUnKVxuICAgICAgICAgICAgLm9wdGlvbignLS1wcm94eSA8aG9zdD4nLCAnc3BlY2lmeSB0aGUgaG9zdCBvZiB0aGUgcHJveHkgc2VydmVyJylcbiAgICAgICAgICAgIC5vcHRpb24oJy0tcHJveHktYnlwYXNzIDxydWxlcz4nLCAnc3BlY2lmeSBhIGNvbW1hLXNlcGFyYXRlZCBsaXN0IG9mIHJ1bGVzIHRoYXQgZGVmaW5lIFVSTHMgYWNjZXNzZWQgYnlwYXNzaW5nIHRoZSBwcm94eSBzZXJ2ZXInKVxuICAgICAgICAgICAgLm9wdGlvbignLS1zc2wgPG9wdGlvbnM+JywgJ3NwZWNpZnkgU1NMIG9wdGlvbnMgdG8gcnVuIFRlc3RDYWZlIHByb3h5IHNlcnZlciBvdmVyIHRoZSBIVFRQUyBwcm90b2NvbCcpXG4gICAgICAgICAgICAub3B0aW9uKCctLXZpZGVvIDxwYXRoPicsICdyZWNvcmQgdmlkZW9zIG9mIHRlc3QgcnVucycpXG4gICAgICAgICAgICAub3B0aW9uKCctLXZpZGVvLW9wdGlvbnMgPG9wdGlvbj12YWx1ZVssLi4uXT4nLCAnc3BlY2lmeSB2aWRlbyByZWNvcmRpbmcgb3B0aW9ucycpXG4gICAgICAgICAgICAub3B0aW9uKCctLXZpZGVvLWVuY29kaW5nLW9wdGlvbnMgPG9wdGlvbj12YWx1ZVssLi4uXT4nLCAnc3BlY2lmeSBlbmNvZGluZyBvcHRpb25zJylcbiAgICAgICAgICAgIC5vcHRpb24oJy0tZGV2JywgJ2VuYWJsZXMgbWVjaGFuaXNtcyB0byBsb2cgYW5kIGRpYWdub3NlIGVycm9ycycpXG4gICAgICAgICAgICAub3B0aW9uKCctLXFyLWNvZGUnLCAnb3V0cHV0cyBRUi1jb2RlIHRoYXQgcmVwZWF0cyBVUkxzIHVzZWQgdG8gY29ubmVjdCB0aGUgcmVtb3RlIGJyb3dzZXJzJylcbiAgICAgICAgICAgIC5vcHRpb24oJy0tc2YsIC0tc3RvcC1vbi1maXJzdC1mYWlsJywgJ3N0b3AgYW4gZW50aXJlIHRlc3QgcnVuIGlmIGFueSB0ZXN0IGZhaWxzJylcbiAgICAgICAgICAgIC5vcHRpb24oJy0tdHMtY29uZmlnLXBhdGggPHBhdGg+JywgJ3VzZSBhIGN1c3RvbSBUeXBlU2NyaXB0IGNvbmZpZ3VyYXRpb24gZmlsZSBhbmQgc3BlY2lmeSBpdHMgbG9jYXRpb24nKVxuICAgICAgICAgICAgLm9wdGlvbignLS1jcywgLS1jbGllbnQtc2NyaXB0cyA8cGF0aHM+JywgJ2luamVjdCBzY3JpcHRzIGludG8gdGVzdGVkIHBhZ2VzJywgdGhpcy5fcGFyc2VMaXN0LCBbXSlcbiAgICAgICAgICAgIC5vcHRpb24oJy0tZGlzYWJsZS1wYWdlLWNhY2hpbmcnLCAnZGlzYWJsZSBwYWdlIGNhY2hpbmcgZHVyaW5nIHRlc3QgZXhlY3V0aW9uJylcbiAgICAgICAgICAgIC5vcHRpb24oJy0tZGlzYWJsZS1wYWdlLXJlbG9hZHMnLCAnZGlzYWJsZSBwYWdlIHJlbG9hZHMgYmV0d2VlbiB0ZXN0cycpXG4gICAgICAgICAgICAub3B0aW9uKCctLWRpc2FibGUtc2NyZWVuc2hvdHMnLCAnZGlzYWJsZSBzY3JlZW5zaG90cycpXG4gICAgICAgICAgICAub3B0aW9uKCctLXNjcmVlbnNob3RzLWZ1bGwtcGFnZScsICdlbmFibGUgZnVsbC1wYWdlIHNjcmVlbnNob3RzJylcblxuICAgICAgICAgICAgLy8gTk9URTogdGhlc2Ugb3B0aW9ucyB3aWxsIGJlIGhhbmRsZWQgYnkgY2hhbGsgaW50ZXJuYWxseVxuICAgICAgICAgICAgLm9wdGlvbignLS1jb2xvcicsICdmb3JjZSBjb2xvcnMgaW4gY29tbWFuZCBsaW5lJylcbiAgICAgICAgICAgIC5vcHRpb24oJy0tbm8tY29sb3InLCAnZGlzYWJsZSBjb2xvcnMgaW4gY29tbWFuZCBsaW5lJyk7XG5cbiAgICAgICAgLy8gTk9URTogdGVtcG9yYXJ5IGhpZGUgZXhwZXJpbWVudGFsIG9wdGlvbnMgZnJvbSAtLWhlbHAgY29tbWFuZFxuICAgICAgICB0aGlzLmV4cGVyaW1lbnRhbFxuICAgICAgICAgICAgLmFsbG93VW5rbm93bk9wdGlvbigpXG4gICAgICAgICAgICAub3B0aW9uKCctLWRpc2FibGUtbXVsdGlwbGUtd2luZG93cycsICdkaXNhYmxlIG11bHRpcGxlIHdpbmRvd3MgbW9kZScpXG4gICAgICAgICAgICAub3B0aW9uKCctLWV4cGVyaW1lbnRhbC1jb21waWxlci1zZXJ2aWNlJywgJ3J1biBjb21waWxlciBpbiBhIHNlcGFyYXRlIHByb2Nlc3MnKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIF9wYXJzZUxpc3QgKHZhbDogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgICAgICByZXR1cm4gdmFsLnNwbGl0KCcsJyk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfY2hlY2tBbmRDb3VudFJlbW90ZXMgKGJyb3dzZXI6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgICAgICBjb25zdCByZW1vdGVNYXRjaCA9IGJyb3dzZXIubWF0Y2goUkVNT1RFX0FMSUFTX1JFKTtcblxuICAgICAgICBpZiAocmVtb3RlTWF0Y2gpIHtcbiAgICAgICAgICAgIHRoaXMucmVtb3RlQ291bnQgKz0gcGFyc2VJbnQocmVtb3RlTWF0Y2hbMV0sIDEwKSB8fCAxO1xuXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBwdWJsaWMgYXN5bmMgX3BhcnNlRmlsdGVyaW5nT3B0aW9ucyAoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGlmICh0aGlzLm9wdHMudGVzdEdyZXApXG4gICAgICAgICAgICB0aGlzLm9wdHMudGVzdEdyZXAgPSBnZXRHcmVwT3B0aW9ucygnLS10ZXN0LWdyZXAnLCB0aGlzLm9wdHMudGVzdEdyZXAgYXMgc3RyaW5nKTtcblxuICAgICAgICBpZiAodGhpcy5vcHRzLmZpeHR1cmVHcmVwKVxuICAgICAgICAgICAgdGhpcy5vcHRzLmZpeHR1cmVHcmVwID0gZ2V0R3JlcE9wdGlvbnMoJy0tZml4dHVyZS1ncmVwJywgdGhpcy5vcHRzLmZpeHR1cmVHcmVwIGFzIHN0cmluZyk7XG5cbiAgICAgICAgaWYgKHRoaXMub3B0cy50ZXN0TWV0YSlcbiAgICAgICAgICAgIHRoaXMub3B0cy50ZXN0TWV0YSA9IGF3YWl0IGdldE1ldGFPcHRpb25zKCctLXRlc3QtbWV0YScsIHRoaXMub3B0cy50ZXN0TWV0YSBhcyBzdHJpbmcpO1xuXG4gICAgICAgIGlmICh0aGlzLm9wdHMuZml4dHVyZU1ldGEpXG4gICAgICAgICAgICB0aGlzLm9wdHMuZml4dHVyZU1ldGEgPSBhd2FpdCBnZXRNZXRhT3B0aW9ucygnLS1maXh0dXJlLW1ldGEnLCB0aGlzLm9wdHMuZml4dHVyZU1ldGEgYXMgc3RyaW5nKTtcblxuICAgICAgICB0aGlzLm9wdHMuZmlsdGVyID0gZ2V0RmlsdGVyRm4odGhpcy5vcHRzKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIF9wYXJzZUFwcEluaXREZWxheSAoKTogdm9pZCB7XG4gICAgICAgIGlmICh0aGlzLm9wdHMuYXBwSW5pdERlbGF5KSB7XG4gICAgICAgICAgICBhc3NlcnRUeXBlKGlzLm5vbk5lZ2F0aXZlTnVtYmVyU3RyaW5nLCBudWxsLCAnVGVzdGVkIGFwcCBpbml0aWFsaXphdGlvbiBkZWxheScsIHRoaXMub3B0cy5hcHBJbml0RGVsYXkpO1xuXG4gICAgICAgICAgICB0aGlzLm9wdHMuYXBwSW5pdERlbGF5ID0gcGFyc2VJbnQodGhpcy5vcHRzLmFwcEluaXREZWxheSBhcyBzdHJpbmcsIDEwKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgX3BhcnNlU2VsZWN0b3JUaW1lb3V0ICgpOiB2b2lkIHtcbiAgICAgICAgaWYgKHRoaXMub3B0cy5zZWxlY3RvclRpbWVvdXQpIHtcbiAgICAgICAgICAgIGFzc2VydFR5cGUoaXMubm9uTmVnYXRpdmVOdW1iZXJTdHJpbmcsIG51bGwsICdTZWxlY3RvciB0aW1lb3V0JywgdGhpcy5vcHRzLnNlbGVjdG9yVGltZW91dCk7XG5cbiAgICAgICAgICAgIHRoaXMub3B0cy5zZWxlY3RvclRpbWVvdXQgPSBwYXJzZUludCh0aGlzLm9wdHMuc2VsZWN0b3JUaW1lb3V0IGFzIHN0cmluZywgMTApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfcGFyc2VBc3NlcnRpb25UaW1lb3V0ICgpOiB2b2lkIHtcbiAgICAgICAgaWYgKHRoaXMub3B0cy5hc3NlcnRpb25UaW1lb3V0KSB7XG4gICAgICAgICAgICBhc3NlcnRUeXBlKGlzLm5vbk5lZ2F0aXZlTnVtYmVyU3RyaW5nLCBudWxsLCAnQXNzZXJ0aW9uIHRpbWVvdXQnLCB0aGlzLm9wdHMuYXNzZXJ0aW9uVGltZW91dCk7XG5cbiAgICAgICAgICAgIHRoaXMub3B0cy5hc3NlcnRpb25UaW1lb3V0ID0gcGFyc2VJbnQodGhpcy5vcHRzLmFzc2VydGlvblRpbWVvdXQgYXMgc3RyaW5nLCAxMCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIF9wYXJzZVBhZ2VMb2FkVGltZW91dCAoKTogdm9pZCB7XG4gICAgICAgIGlmICh0aGlzLm9wdHMucGFnZUxvYWRUaW1lb3V0KSB7XG4gICAgICAgICAgICBhc3NlcnRUeXBlKGlzLm5vbk5lZ2F0aXZlTnVtYmVyU3RyaW5nLCBudWxsLCAnUGFnZSBsb2FkIHRpbWVvdXQnLCB0aGlzLm9wdHMucGFnZUxvYWRUaW1lb3V0KTtcblxuICAgICAgICAgICAgdGhpcy5vcHRzLnBhZ2VMb2FkVGltZW91dCA9IHBhcnNlSW50KHRoaXMub3B0cy5wYWdlTG9hZFRpbWVvdXQgYXMgc3RyaW5nLCAxMCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIF9wYXJzZVNwZWVkICgpOiB2b2lkIHtcbiAgICAgICAgaWYgKHRoaXMub3B0cy5zcGVlZClcbiAgICAgICAgICAgIHRoaXMub3B0cy5zcGVlZCA9IHBhcnNlRmxvYXQodGhpcy5vcHRzLnNwZWVkIGFzIHN0cmluZyk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfcGFyc2VDb25jdXJyZW5jeSAoKTogdm9pZCB7XG4gICAgICAgIGlmICh0aGlzLm9wdHMuY29uY3VycmVuY3kpXG4gICAgICAgICAgICB0aGlzLm9wdHMuY29uY3VycmVuY3kgPSBwYXJzZUludCh0aGlzLm9wdHMuY29uY3VycmVuY3kgYXMgc3RyaW5nLCAxMCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfcGFyc2VQb3J0cyAoKTogdm9pZCB7XG4gICAgICAgIGlmICh0aGlzLm9wdHMucG9ydHMpIHtcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZFBvcnRzID0gKHRoaXMub3B0cy5wb3J0cyBhcyBzdHJpbmcpIC8qIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tZXh0cmEtcGFyZW5zICovXG4gICAgICAgICAgICAgICAgLnNwbGl0KCcsJylcbiAgICAgICAgICAgICAgICAubWFwKENMSUFyZ3VtZW50UGFyc2VyLl9wYXJzZVBvcnROdW1iZXIpO1xuXG4gICAgICAgICAgICBpZiAocGFyc2VkUG9ydHMubGVuZ3RoIDwgMilcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgR2VuZXJhbEVycm9yKFJVTlRJTUVfRVJST1JTLnBvcnRzT3B0aW9uUmVxdWlyZXNUd29OdW1iZXJzKTtcblxuICAgICAgICAgICAgdGhpcy5vcHRzLnBvcnRzID0gcGFyc2VkUG9ydHMgYXMgbnVtYmVyW107XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIF9wYXJzZUJyb3dzZXJzRnJvbUFyZ3MgKCk6IHZvaWQge1xuICAgICAgICBjb25zdCBicm93c2Vyc0FyZyA9IHRoaXMucHJvZ3JhbS5hcmdzWzBdIHx8ICcnO1xuXG4gICAgICAgIHRoaXMub3B0cy5icm93c2VycyA9IHNwbGl0UXVvdGVkVGV4dChicm93c2Vyc0FyZywgJywnKVxuICAgICAgICAgICAgLmZpbHRlcihicm93c2VyID0+IGJyb3dzZXIgJiYgdGhpcy5fY2hlY2tBbmRDb3VudFJlbW90ZXMoYnJvd3NlcikpO1xuICAgIH1cblxuICAgIHB1YmxpYyBhc3luYyBfcGFyc2VTc2xPcHRpb25zICgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgaWYgKHRoaXMub3B0cy5zc2wpXG4gICAgICAgICAgICB0aGlzLm9wdHMuc3NsID0gYXdhaXQgZ2V0U1NMT3B0aW9ucyh0aGlzLm9wdHMuc3NsIGFzIHN0cmluZyk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBfcGFyc2VSZXBvcnRlcnMgKCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBjb25zdCByZXBvcnRlcnMgPSB0aGlzLm9wdHMucmVwb3J0ZXIgPyAodGhpcy5vcHRzLnJlcG9ydGVyIGFzIHN0cmluZykuc3BsaXQoJywnKSA6IFtdOyAvKiBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLWV4dHJhLXBhcmVucyovXG5cbiAgICAgICAgdGhpcy5vcHRzLnJlcG9ydGVyID0gcmVwb3J0ZXJzLm1hcCgocmVwb3J0ZXI6IHN0cmluZykgPT4ge1xuICAgICAgICAgICAgY29uc3Qgc2VwYXJhdG9ySW5kZXggPSByZXBvcnRlci5pbmRleE9mKCc6Jyk7XG5cbiAgICAgICAgICAgIGlmIChzZXBhcmF0b3JJbmRleCA8IDApXG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgbmFtZTogcmVwb3J0ZXIgfTtcblxuICAgICAgICAgICAgY29uc3QgbmFtZSAgID0gcmVwb3J0ZXIuc3Vic3RyaW5nKDAsIHNlcGFyYXRvckluZGV4KTtcbiAgICAgICAgICAgIGNvbnN0IG91dHB1dCA9IHJlcG9ydGVyLnN1YnN0cmluZyhzZXBhcmF0b3JJbmRleCArIDEpO1xuXG4gICAgICAgICAgICByZXR1cm4geyBuYW1lLCBvdXRwdXQgfTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfcGFyc2VGaWxlTGlzdCAoKTogdm9pZCB7XG4gICAgICAgIHRoaXMub3B0cy5zcmMgPSB0aGlzLnByb2dyYW0uYXJncy5zbGljZSgxKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIF9wYXJzZVNjcmVlbnNob3RPcHRpb25zICgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgaWYgKHRoaXMub3B0cy5zY3JlZW5zaG90cylcbiAgICAgICAgICAgIHRoaXMub3B0cy5zY3JlZW5zaG90cyA9IGF3YWl0IGdldFNjcmVlbnNob3RPcHRpb25zKHRoaXMub3B0cy5zY3JlZW5zaG90cyk7XG4gICAgICAgIGVsc2VcbiAgICAgICAgICAgIHRoaXMub3B0cy5zY3JlZW5zaG90cyA9IHt9O1xuXG4gICAgICAgIGlmICghaGFzKHRoaXMub3B0cy5zY3JlZW5zaG90cywgU0NSRUVOU0hPVF9PUFRJT05fTkFNRVMucGF0aFBhdHRlcm4pICYmIHRoaXMub3B0cy5zY3JlZW5zaG90UGF0aFBhdHRlcm4pXG4gICAgICAgICAgICB0aGlzLm9wdHMuc2NyZWVuc2hvdHNbU0NSRUVOU0hPVF9PUFRJT05fTkFNRVMucGF0aFBhdHRlcm5dID0gdGhpcy5vcHRzLnNjcmVlbnNob3RQYXRoUGF0dGVybjtcblxuICAgICAgICBpZiAoIWhhcyh0aGlzLm9wdHMuc2NyZWVuc2hvdHMsIFNDUkVFTlNIT1RfT1BUSU9OX05BTUVTLnRha2VPbkZhaWxzKSAmJiB0aGlzLm9wdHMuc2NyZWVuc2hvdHNPbkZhaWxzKVxuICAgICAgICAgICAgdGhpcy5vcHRzLnNjcmVlbnNob3RzW1NDUkVFTlNIT1RfT1BUSU9OX05BTUVTLnRha2VPbkZhaWxzXSA9IHRoaXMub3B0cy5zY3JlZW5zaG90c09uRmFpbHM7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBfcGFyc2VWaWRlb09wdGlvbnMgKCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBpZiAodGhpcy5vcHRzLnZpZGVvT3B0aW9ucylcbiAgICAgICAgICAgIHRoaXMub3B0cy52aWRlb09wdGlvbnMgPSBhd2FpdCBnZXRWaWRlb09wdGlvbnModGhpcy5vcHRzLnZpZGVvT3B0aW9ucyBhcyBzdHJpbmcpO1xuXG4gICAgICAgIGlmICh0aGlzLm9wdHMudmlkZW9FbmNvZGluZ09wdGlvbnMpXG4gICAgICAgICAgICB0aGlzLm9wdHMudmlkZW9FbmNvZGluZ09wdGlvbnMgPSBhd2FpdCBnZXRWaWRlb09wdGlvbnModGhpcy5vcHRzLnZpZGVvRW5jb2RpbmdPcHRpb25zIGFzIHN0cmluZyk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfcGFyc2VMaXN0QnJvd3NlcnMgKCk6IHZvaWQge1xuICAgICAgICBjb25zdCBsaXN0QnJvd3Nlck9wdGlvbiA9IHRoaXMub3B0cy5saXN0QnJvd3NlcnM7XG5cbiAgICAgICAgdGhpcy5vcHRzLmxpc3RCcm93c2VycyA9ICEhdGhpcy5vcHRzLmxpc3RCcm93c2VycztcblxuICAgICAgICBpZiAoIXRoaXMub3B0cy5saXN0QnJvd3NlcnMpXG4gICAgICAgICAgICByZXR1cm47XG5cbiAgICAgICAgdGhpcy5vcHRzLnByb3ZpZGVyTmFtZSA9IHR5cGVvZiBsaXN0QnJvd3Nlck9wdGlvbiA9PT0gJ3N0cmluZycgPyBsaXN0QnJvd3Nlck9wdGlvbiA6ICdsb2NhbGx5LWluc3RhbGxlZCc7XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIHBhcnNlIChhcmd2OiBzdHJpbmdbXSk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICB0aGlzLnByb2dyYW0ucGFyc2UoYXJndik7XG4gICAgICAgIHRoaXMuZXhwZXJpbWVudGFsLnBhcnNlKGFyZ3YpO1xuXG4gICAgICAgIHRoaXMuYXJncyA9IHRoaXMucHJvZ3JhbS5hcmdzO1xuXG4gICAgICAgIHRoaXMub3B0cyA9IHsgLi4udGhpcy5leHBlcmltZW50YWwub3B0cygpLCAuLi50aGlzLnByb2dyYW0ub3B0cygpIH07XG5cbiAgICAgICAgdGhpcy5fcGFyc2VMaXN0QnJvd3NlcnMoKTtcblxuICAgICAgICAvLyBOT1RFOiB0aGUgJy0tbGlzdC1icm93c2Vycycgb3B0aW9uIG9ubHkgbGlzdHMgYnJvd3NlcnMgYW5kIGltbWVkaWF0ZWx5IGV4aXRzIHRoZSBhcHAuXG4gICAgICAgIC8vIFRoZXJlZm9yZSwgd2UgZG9uJ3QgbmVlZCB0byBwcm9jZXNzIG90aGVyIGFyZ3VtZW50cy5cbiAgICAgICAgaWYgKHRoaXMub3B0cy5saXN0QnJvd3NlcnMpXG4gICAgICAgICAgICByZXR1cm47XG5cbiAgICAgICAgdGhpcy5fcGFyc2VTZWxlY3RvclRpbWVvdXQoKTtcbiAgICAgICAgdGhpcy5fcGFyc2VBc3NlcnRpb25UaW1lb3V0KCk7XG4gICAgICAgIHRoaXMuX3BhcnNlUGFnZUxvYWRUaW1lb3V0KCk7XG4gICAgICAgIHRoaXMuX3BhcnNlQXBwSW5pdERlbGF5KCk7XG4gICAgICAgIHRoaXMuX3BhcnNlU3BlZWQoKTtcbiAgICAgICAgdGhpcy5fcGFyc2VQb3J0cygpO1xuICAgICAgICB0aGlzLl9wYXJzZUJyb3dzZXJzRnJvbUFyZ3MoKTtcbiAgICAgICAgdGhpcy5fcGFyc2VDb25jdXJyZW5jeSgpO1xuICAgICAgICB0aGlzLl9wYXJzZUZpbGVMaXN0KCk7XG5cbiAgICAgICAgYXdhaXQgdGhpcy5fcGFyc2VGaWx0ZXJpbmdPcHRpb25zKCk7XG4gICAgICAgIGF3YWl0IHRoaXMuX3BhcnNlU2NyZWVuc2hvdE9wdGlvbnMoKTtcbiAgICAgICAgYXdhaXQgdGhpcy5fcGFyc2VWaWRlb09wdGlvbnMoKTtcbiAgICAgICAgYXdhaXQgdGhpcy5fcGFyc2VTc2xPcHRpb25zKCk7XG4gICAgICAgIGF3YWl0IHRoaXMuX3BhcnNlUmVwb3J0ZXJzKCk7XG4gICAgfVxuXG4gICAgcHVibGljIGdldFJ1bk9wdGlvbnMgKCk6IFJ1bm5lclJ1bk9wdGlvbnMge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuXG4gICAgICAgIFJVTl9PUFRJT05fTkFNRVMuZm9yRWFjaChvcHRpb25OYW1lID0+IHtcbiAgICAgICAgICAgIGlmIChvcHRpb25OYW1lIGluIHRoaXMub3B0cylcbiAgICAgICAgICAgICAgICAvLyBAdHMtaWdub3JlIGEgaGFjayB0byBhZGQgYW4gaW5kZXggc2lnbmF0dXJlIHRvIGludGVyZmFjZVxuICAgICAgICAgICAgICAgIHJlc3VsdFtvcHRpb25OYW1lXSA9IHRoaXMub3B0c1tvcHRpb25OYW1lXTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdCBhcyBSdW5uZXJSdW5PcHRpb25zO1xuICAgIH1cbn1cbiJdfQ==