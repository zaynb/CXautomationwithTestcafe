import {Selector,browser} from 'testcafe'
import basePage from "../pages/basePage";

const baseObj = new basePage();

export default class loginPage{
constructor(){
this.usernameFiled = Selector("input[id='input-14']");
this.passFiled     =  Selector("#input-20")
this.loginBtn      = Selector("button[type='button']")
this.invalidLoginErrorMsg   = Selector("li").withText("Error IB01001: You can't login using provided credentials, please make sure your account is active and that you are using the correct credentials")
}

async enterUsername(username)
{
    baseObj.type(this.usernameFiled , username);
};

async enterPassword(password)
{
    baseObj.type(this.passFiled , password);
};

async pressLogin()
{
    baseObj.click(this.loginBtn);
};

async userLoginSuccessfully(username , password)
{
    baseObj.type(this.usernameFiled , username);
    baseObj.type(this.passFiled , password);
    baseObj.click(this.loginBtn);
}

}




