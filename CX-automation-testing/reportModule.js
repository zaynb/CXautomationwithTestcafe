module.exports.reportHelper = function () {
  basePath = "./allure/allure-report/";
  baseRaw = "./allure/allure-results/";
  filesPathesArray = [
    "data/behaviors.json",
    "data/suites.json",
    "data/packages.json",
    "data/timeline.json",
  ];
  statisticsFilesArray = [
    "widgets/suites.json",
    "widgets/behaviors.json",
    "widgets/summary.json",
  ];
  customUIFilesPathesArray = [
    "app.js",
    "styles.css",
    "logo.png",
    "childrenObject.json",
  ];
  var passedCount = 0;
  var failedCount = 0;

  var readChildObject = function () {
    var childsArrayObject = require("./allure/allure-results/childrenObject.json");
    return childsArrayObject;
  };

  function injectDataIntoReport(childObject) {
    for (var i = 0; i < filesPathesArray.length; i++) {
      const originalJson = require(basePath + filesPathesArray[i]);
      var data = fs
        .readFileSync(basePath + filesPathesArray[i])
        .toString()
        .split("\n");
      data.forEach(function (line, lineIndex) {
        if (
          line.includes(
            "Generate all-report in a loop with mandatory fields only"
          )
        ) {
          data.splice(
            lineIndex + 1,
            0,
            '"children"' + ":" + JSON.stringify(childObject, null, 4) + ","
          );
        }
      });
      fs.writeFile(
        basePath + filesPathesArray[i],
        JSON.stringify(JSON.parse(data.join("\n")), null, 1),
        (err) => {
          if (err) {
            throw err;
          }
        }
      );
    }
  }

  function injectStatisticsIntoReport(childObject) {
    for (var i = 0; i < statisticsFilesArray.length; i++) {
      const originalJson = require(basePath + statisticsFilesArray[i]);
      if (statisticsFilesArray[i] != "widgets/summary.json") {
        originalJson["total"] = passedCount + failedCount;
        originalJson["items"][0]["statistic"]["failed"] += failedCount;
        originalJson["items"][0]["statistic"]["passed"] += passedCount;
        originalJson["items"][0]["statistic"]["total"] +=
          passedCount + failedCount;
      } else {
        originalJson["reportName"] = "Afaqy Testing Report";
        originalJson["statistic"]["failed"] += failedCount;
        originalJson["statistic"]["passed"] += passedCount;
        originalJson["statistic"]["total"] += passedCount + failedCount;
      }
      fs.writeFile(
        basePath + statisticsFilesArray[i],
        JSON.stringify(originalJson, null, 4),
        (err) => {
          if (err) {
            throw err;
          }
        }
      );
    }
  }

  function moveTestCases() {
    fs.readdir(baseRaw + "data/", (err, files) => {
      files.forEach((file) => {
        fs.copyFile(
          baseRaw + "data/" + file,
          basePath + "data/test-cases/" + file,
          (err) => {
            if (err) throw err;
          }
        );
      });
    });
    for (let i = 0; i < customUIFilesPathesArray.length; i++) {
      var filee = customUIFilesPathesArray[i];
      var target = null;
      filee != "childrenObject.json" ?
        (target = basePath + filee) :
        (target = basePath + "widgets/status-chart.json");
      fs.copyFile(baseRaw + filee, target, (err) => {
        if (err) throw err;
      });
    }
    console.log("Report test data injected successfully");
  }

  function readCountTestStatus(childObject) {
    for (let i = 0; i < childObject.length; i++) {
      currentDic = childObject[i];
      dicStatus = currentDic["status"];
      if (dicStatus == "passed") {
        passedCount++;
      } else if (dicStatus == "failed") {
        failedCount++;
      }
    }
  }

  injectDataIntoReport(readChildObject());
  moveTestCases();
  readCountTestStatus(readChildObject());
  injectStatisticsIntoReport(readChildObject());
};