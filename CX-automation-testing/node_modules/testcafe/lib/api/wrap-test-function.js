"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_controller_1 = __importDefault(require("./test-controller"));
const test_run_tracker_1 = __importDefault(require("./test-run-tracker"));
const error_list_1 = __importDefault(require("../errors/error-list"));
const test_run_1 = require("../errors/test-run");
const add_rendered_warning_1 = __importDefault(require("../notifications/add-rendered-warning"));
const warning_message_1 = __importDefault(require("../notifications/warning-message"));
function wrapTestFunction(fn) {
    return async (testRun) => {
        let result = null;
        const errList = new error_list_1.default();
        const markeredfn = test_run_tracker_1.default.addTrackingMarkerToFunction(testRun.id, fn);
        function addWarnings(callsiteSet, message) {
            callsiteSet.forEach(callsite => {
                add_rendered_warning_1.default(testRun.warningLog, message, callsite);
                callsiteSet.delete(callsite);
            });
        }
        function addErrors(callsiteSet, ErrorClass) {
            callsiteSet.forEach(callsite => {
                errList.addError(new ErrorClass(callsite));
                callsiteSet.delete(callsite);
            });
        }
        testRun.controller = new test_controller_1.default(testRun);
        testRun.observedCallsites.clear();
        test_run_tracker_1.default.ensureEnabled();
        try {
            result = await markeredfn(testRun.controller);
        }
        catch (err) {
            errList.addError(err);
        }
        if (!errList.hasUncaughtErrorsInTestCode) {
            addWarnings(testRun.observedCallsites.unawaitedSnapshotCallsites, warning_message_1.default.missingAwaitOnSnapshotProperty);
            addErrors(testRun.observedCallsites.callsitesWithoutAwait, test_run_1.MissingAwaitError);
        }
        if (errList.hasErrors)
            throw errList;
        return result;
    };
}
exports.default = wrapTestFunction;
module.exports = exports.default;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid3JhcC10ZXN0LWZ1bmN0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2FwaS93cmFwLXRlc3QtZnVuY3Rpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSx3RUFBK0M7QUFDL0MsMEVBQWdEO0FBRWhELHNFQUFxRDtBQUNyRCxpREFBdUQ7QUFDdkQsaUdBQXVFO0FBQ3ZFLHVGQUFnRTtBQUVoRSxTQUF3QixnQkFBZ0IsQ0FBRSxFQUFZO0lBQ2xELE9BQU8sS0FBSyxFQUFFLE9BQWdCLEVBQUUsRUFBRTtRQUM5QixJQUFJLE1BQU0sR0FBUyxJQUFJLENBQUM7UUFDeEIsTUFBTSxPQUFPLEdBQU0sSUFBSSxvQkFBaUIsRUFBRSxDQUFDO1FBQzNDLE1BQU0sVUFBVSxHQUFHLDBCQUFjLENBQUMsMkJBQTJCLENBQUMsT0FBTyxDQUFDLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQztRQUU5RSxTQUFTLFdBQVcsQ0FBRSxXQUFxQyxFQUFFLE9BQWU7WUFDeEUsV0FBVyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsRUFBRTtnQkFDM0IsOEJBQWtCLENBQUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUUsUUFBUSxDQUFDLENBQUM7Z0JBQzFELFdBQVcsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUM7WUFDakMsQ0FBQyxDQUFDLENBQUM7UUFDUCxDQUFDO1FBRUQsU0FBUyxTQUFTLENBQUUsV0FBcUMsRUFBRSxVQUFlO1lBQ3RFLFdBQVcsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLEVBQUU7Z0JBQzNCLE9BQU8sQ0FBQyxRQUFRLENBQUMsSUFBSSxVQUFVLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztnQkFDM0MsV0FBVyxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUNqQyxDQUFDLENBQUMsQ0FBQztRQUNQLENBQUM7UUFFRCxPQUFPLENBQUMsVUFBVSxHQUFHLElBQUkseUJBQWMsQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUVqRCxPQUFPLENBQUMsaUJBQWlCLENBQUMsS0FBSyxFQUFFLENBQUM7UUFFbEMsMEJBQWMsQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUUvQixJQUFJO1lBQ0EsTUFBTSxHQUFHLE1BQU0sVUFBVSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQztTQUNqRDtRQUNELE9BQU8sR0FBRyxFQUFFO1lBQ1IsT0FBTyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQztTQUN6QjtRQUVELElBQUksQ0FBQyxPQUFPLENBQUMsMkJBQTJCLEVBQUU7WUFDdEMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxpQkFBaUIsQ0FBQywwQkFBMEIsRUFBRSx5QkFBZ0IsQ0FBQyw4QkFBOEIsQ0FBQyxDQUFDO1lBQ25ILFNBQVMsQ0FBQyxPQUFPLENBQUMsaUJBQWlCLENBQUMscUJBQXFCLEVBQUUsNEJBQWlCLENBQUMsQ0FBQztTQUNqRjtRQUVELElBQUksT0FBTyxDQUFDLFNBQVM7WUFDakIsTUFBTSxPQUFPLENBQUM7UUFFbEIsT0FBTyxNQUFNLENBQUM7SUFDbEIsQ0FBQyxDQUFDO0FBQ04sQ0FBQztBQTNDRCxtQ0EyQ0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgVGVzdENvbnRyb2xsZXIgZnJvbSAnLi90ZXN0LWNvbnRyb2xsZXInO1xuaW1wb3J0IHRlc3RSdW5UcmFja2VyIGZyb20gJy4vdGVzdC1ydW4tdHJhY2tlcic7XG5pbXBvcnQgeyBUZXN0UnVuIH0gZnJvbSAnLi90ZXN0LXJ1bi10cmFja2VyLmQnO1xuaW1wb3J0IFRlc3RDYWZlRXJyb3JMaXN0IGZyb20gJy4uL2Vycm9ycy9lcnJvci1saXN0JztcbmltcG9ydCB7IE1pc3NpbmdBd2FpdEVycm9yIH0gZnJvbSAnLi4vZXJyb3JzL3Rlc3QtcnVuJztcbmltcG9ydCBhZGRSZW5kZXJlZFdhcm5pbmcgZnJvbSAnLi4vbm90aWZpY2F0aW9ucy9hZGQtcmVuZGVyZWQtd2FybmluZyc7XG5pbXBvcnQgV0FSTklOR19NRVNTQUdFUyBmcm9tICcuLi9ub3RpZmljYXRpb25zL3dhcm5pbmctbWVzc2FnZSc7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHdyYXBUZXN0RnVuY3Rpb24gKGZuOiBGdW5jdGlvbik6IEZ1bmN0aW9uIHtcbiAgICByZXR1cm4gYXN5bmMgKHRlc3RSdW46IFRlc3RSdW4pID0+IHtcbiAgICAgICAgbGV0IHJlc3VsdCAgICAgICA9IG51bGw7XG4gICAgICAgIGNvbnN0IGVyckxpc3QgICAgPSBuZXcgVGVzdENhZmVFcnJvckxpc3QoKTtcbiAgICAgICAgY29uc3QgbWFya2VyZWRmbiA9IHRlc3RSdW5UcmFja2VyLmFkZFRyYWNraW5nTWFya2VyVG9GdW5jdGlvbih0ZXN0UnVuLmlkLCBmbik7XG5cbiAgICAgICAgZnVuY3Rpb24gYWRkV2FybmluZ3MgKGNhbGxzaXRlU2V0OiBTZXQ8UmVjb3JkPHN0cmluZywgYW55Pj4sIG1lc3NhZ2U6IHN0cmluZyk6IHZvaWQge1xuICAgICAgICAgICAgY2FsbHNpdGVTZXQuZm9yRWFjaChjYWxsc2l0ZSA9PiB7XG4gICAgICAgICAgICAgICAgYWRkUmVuZGVyZWRXYXJuaW5nKHRlc3RSdW4ud2FybmluZ0xvZywgbWVzc2FnZSwgY2FsbHNpdGUpO1xuICAgICAgICAgICAgICAgIGNhbGxzaXRlU2V0LmRlbGV0ZShjYWxsc2l0ZSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIGFkZEVycm9ycyAoY2FsbHNpdGVTZXQ6IFNldDxSZWNvcmQ8c3RyaW5nLCBhbnk+PiwgRXJyb3JDbGFzczogYW55KTogdm9pZCB7XG4gICAgICAgICAgICBjYWxsc2l0ZVNldC5mb3JFYWNoKGNhbGxzaXRlID0+IHtcbiAgICAgICAgICAgICAgICBlcnJMaXN0LmFkZEVycm9yKG5ldyBFcnJvckNsYXNzKGNhbGxzaXRlKSk7XG4gICAgICAgICAgICAgICAgY2FsbHNpdGVTZXQuZGVsZXRlKGNhbGxzaXRlKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgdGVzdFJ1bi5jb250cm9sbGVyID0gbmV3IFRlc3RDb250cm9sbGVyKHRlc3RSdW4pO1xuXG4gICAgICAgIHRlc3RSdW4ub2JzZXJ2ZWRDYWxsc2l0ZXMuY2xlYXIoKTtcblxuICAgICAgICB0ZXN0UnVuVHJhY2tlci5lbnN1cmVFbmFibGVkKCk7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IG1hcmtlcmVkZm4odGVzdFJ1bi5jb250cm9sbGVyKTtcbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICBlcnJMaXN0LmFkZEVycm9yKGVycik7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWVyckxpc3QuaGFzVW5jYXVnaHRFcnJvcnNJblRlc3RDb2RlKSB7XG4gICAgICAgICAgICBhZGRXYXJuaW5ncyh0ZXN0UnVuLm9ic2VydmVkQ2FsbHNpdGVzLnVuYXdhaXRlZFNuYXBzaG90Q2FsbHNpdGVzLCBXQVJOSU5HX01FU1NBR0VTLm1pc3NpbmdBd2FpdE9uU25hcHNob3RQcm9wZXJ0eSk7XG4gICAgICAgICAgICBhZGRFcnJvcnModGVzdFJ1bi5vYnNlcnZlZENhbGxzaXRlcy5jYWxsc2l0ZXNXaXRob3V0QXdhaXQsIE1pc3NpbmdBd2FpdEVycm9yKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChlcnJMaXN0Lmhhc0Vycm9ycylcbiAgICAgICAgICAgIHRocm93IGVyckxpc3Q7XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9O1xufVxuIl19