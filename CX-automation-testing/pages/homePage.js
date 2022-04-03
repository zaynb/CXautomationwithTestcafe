import {Selector,browser} from 'testcafe'
import basePage from '../pages/basePage'

const baseObj = new basePage();


export default class homePage{
constructor(){

    this.menuBtn         = Selector("button[type='button']")
    this.unitsItemInMenu = Selector("li").withText("Units")
    this.reportsItemInMenu = Selector("li").withText("Reports")
    this.imgLogo         = Selector("a").withAttribute("alt","logo")

}

async openMenuList ()
{
    baseObj.click(this.menuBtn)

}

async navigatesToUnitsModule()
{
    baseObj.click(this.unitsItemInMenu)

}

async navigatesToReportsModule(){
    baseObj.click(this.reportsItemInMenu)
}


}
