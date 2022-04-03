import loginPage from '../pages/loginPage';
import homePage from '../pages/homePage';
import data from     "../testData/data";

const testdata    = new data()
const loginObj    = new loginPage()
const homeObj     = new homePage()
const CxUrl      = 'http://87.119.195.19/emasraf-cx/#/Login'

const username        = testdata.validCxUsername;
const username2       = testdata.validCxUsername2;
const password        = testdata.validCxPassword;
const invalidUsername = testdata.invalidAvlUsername ;
const invalidPassword = testdata.invalidAvlPassword ;

const loginErrorMsg         = loginObj.invalidLoginErrorMsg ;
const loginMenuBtnAssertion = homeObj.menuBtn;
const loginLogoAssertion    = homeObj.imgLogo;

fixture `login Module`.page(CxUrl).beforeEach(async (t) => {
    await t.setTestSpeed(0.5);
    await t.maximizeWindow();
  });

 
test
.meta({ID: 'TEST-001', SEVERITY: 'blocker', USER_STORY: '001-',TEST_RUN: '001'})
('invalid login', async t =>{
    loginObj.enterUsername(invalidUsername)
    loginObj.enterPassword(invalidPassword)
    loginObj.pressLogin(t)
    await t.expect(loginErrorMsg.visible,{timeout: 5000}).ok();    
})


test
.meta({ID: 'TEST-002', SEVERITY: 'blocker', USER_STORY: '002',TEST_RUN: '002'})
('valid login', async t =>{
    loginObj.enterUsername(username)
    loginObj.enterPassword(password)
    loginObj.pressLogin(t)
    await t.expect(loginMenuBtnAssertion.visible,{timeout: 5000}).ok()
}) 

test
.meta({ID: 'TEST-003', SEVERITY: 'blocker', USER_STORY: '003',TEST_RUN: '003'})
('block user after 2 invalid trial ', async t =>{
    loginObj.enterUsername(username2)
    loginObj.enterPassword(invalidPassword)
    loginObj.pressLogin(t)

    loginObj.enterUsername(username2)
    loginObj.enterPassword(invalidPassword)
    loginObj.pressLogin(t)

    loginObj.enterUsername(username2)
    loginObj.enterPassword(password)
    loginObj.pressLogin(t)
    await t.expect(loginErrorMsg.visible,{timeout: 5000}).ok();    
})


