'use strict';
let factory,controller;
function configure(create){factory=create;}
function get(){if(!controller){if(!factory)throw Error('Pairing authority is unavailable');controller=factory();}return controller;}
function close(){if(controller)void controller.close();}
module.exports={configure,get,close};
