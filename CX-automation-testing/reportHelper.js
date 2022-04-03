const fs = require('fs')

export default class reportHelper {
    
    constructor() {}

    // Create child object for each report
    createObjectChild (reportName, uID, status, reportStart, reportEnd, reportDur) {
        console.log("Creating Object")
        var childrenListObject = {
            "name": reportName,
            "uid": uID,
            "parentUid": "",
            "status": status,
            "time": {
                "start": reportStart,
                "stop": reportEnd,
                "duration": reportDur
            }
        }
        return childrenListObject
    };
    
    // Create file for each testcase in Global Children Array Object
     createTestCafeFile (dictObject, crashDesc,sMsg, fixtureName, testCaseName) {
        console.log("Creating testcase file")
        const demoTestCase = require('./demoTestCaseFile.json')
        demoTestCase.uid = dictObject.uid
        demoTestCase.name = dictObject.name
        // Fixture name + Testcase name 
        demoTestCase.fullName = fixtureName + "." + testCaseName + "." + dictObject.name
        demoTestCase.time.start = dictObject.time.start
        demoTestCase.time.stop = dictObject.time.stop
        demoTestCase.time.duration = dictObject.time.duration
        demoTestCase.description = crashDesc
        demoTestCase.status = dictObject.status
        demoTestCase.statusMessage = sMsg
        demoTestCase.source = dictObject.uid + ".json"
        fs.writeFile("./allure/allure-results/data/" + dictObject.uid + ".json", JSON.stringify(demoTestCase, null, 4), (err) => {
            if (err) {
                throw err;
            }
        })

    };

}