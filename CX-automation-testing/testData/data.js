export default class testData {
  constructor() {
    const faker = require("faker");

    //credentials
    this.validCxUsername   = "test1";
    this.validCxPassword   = "Passw0rd";
    this.validCxUsername2   = "test2";
   

    // related test data
    this.invalidAvlUsername = faker.name.firstName();
    this.invalidAvlPassword = faker.random.word();

}
}