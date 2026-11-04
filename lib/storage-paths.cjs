'use strict';
const path=require('node:path');
function storagePaths({packaged,smoke,sourceDirectory,executablePath,portableDirectory,appData}){
 const portable=packaged&&!smoke;
 const runtime=portable?(portableDirectory||path.dirname(executablePath)):path.join(sourceDirectory,'runtime');
 return {runtime,settingsFile:smoke?path.join(runtime,'test-settings.json'):portable?path.join(runtime,'settings.json'):path.join(appData,'MobiNote','settings.json')};
}
module.exports={storagePaths};
