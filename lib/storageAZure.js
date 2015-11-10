var azure = require('azure-storage');

var blobSvc = azure.createBlobService('group19133', 'WOH9belk/5HnnUBd0wltxSSfU0pXc8/hzCy37NZVL8Ri5QoJQwitHn98XX56jm+eFGhQ/MhYYIEum0ACH1As/Q==');


blobSvc.deleteBlob('vhds', 'VM-MODEL2.vhd', function(error, response){

     console.log('error-'+error);
   console.log('response-'+JSON.stringify(response));

});