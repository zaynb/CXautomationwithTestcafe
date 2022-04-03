import { Selector, t } from "testcafe";

export default class basePage {
  constructor() {}

  async type(selector, text) {
    await t.typeText(selector, text, {
      paste: true,
      replace: true,
      visibilityCheck: true,
      timeout: 3000,
    });
  }

  async typeWithoutReplace(selector, text) {
    await t.typeText(selector, text, {
      paste: true,
      replace: false,
      visibilityCheck: true,
      timeout: 3000,
    });
  }
  async click(selector) {
    await t.click(selector, { timeout: 5000 });
  }
  async hover(selector) {
    await t.hover(selector);
  }
  async search(selector, text) {
    await t.typeText(selector, text, {
      paste: true,
      replace: true,
      visibilityCheck: true,
      timeout: 5000,
    });
    await t.wait(5000);
  }

  async uploadFile(selector, path) {
    await t.setFilesToUpload(selector, [path]);
  }

  async doubleClick(selector) {
    await t.doubleClick(selector, { timeout: 5000 });
  }

  async changeCheckBoxStatus(selector, status) {
    const elementStatus = await Selector(selector).find("input:checked").exists;
    switch (elementStatus) {
      case true:
        if (status == false) {
          await t.click(selector);
        }
        break;
      case false:
        if (status == true) {
          await t.click(selector);
        }
        break;
    }
  }

  async clickEnterKey() {
    await t.pressKey("enter");
  }

  async waitForElementExistance(selector, timeout = 5000) {
    const elementToWaitFor = await selector.with({ timeout: timeout });
    return await elementToWaitFor.exists;
  }

  async checkDownloadedIfFileExists(fileName, fileExt, timeOut = 60) {
    const fs = require("fs");
    const info = require("path");
    var downloadFolder = process.env.USERPROFILE + "\\Downloads";
    for (let i = 0; i < timeOut; i++) {
      if (fs.existsSync(downloadFolder)) {
        let fileList = fs.readdirSync(downloadFolder);
        if (
          fileList.some(
            (file) => file.includes(fileName) && info.extname(file) == fileExt
          )
        ) {
          return true;
        }
      }
      await t.wait(1000);
    }
  }
}
