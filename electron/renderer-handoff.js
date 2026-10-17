/* global api, HandoffUI, document */
(function(){'use strict';const container=document.getElementById('handoff-body');if(container&&typeof api!=='undefined'&&api.handoffAction)window.handoffUI=HandoffUI.mount(container,{platform:'windows',invoke:(action,args)=>api.handoffAction(action,args),onImported:()=>void window.routineTransfer?.refresh()});})();
