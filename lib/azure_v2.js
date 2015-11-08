'use strict';

var request = require('request'),
   underscore = require('underscore'),
   xMsVersion = '2015-05-01-preview',
   AzureError = require('./azure-error'),
   Authentication = {},
   adal = require('adal-node'),
   tunnelingProxyURL;


module.exports = (function () {

   function getAuthenticationToken(settings, callback) {
      if (Authentication.expiresOn && (new Date().valueOf()) - (1000 * 60 * 10) > Authentication.expiresOn) {
         callback(null, tokenResponse.accessToken);
         return;
      }
      else {
         var AuthenticationContext = adal.AuthenticationContext
            , tenantID = settings.tenantId,
            clientID = settings.clientId,
            resource = "https://management.azure.com/",
            authURL = "https://login.windows.net/" + tenantID,
            secret = settings.secret,
            context = new AuthenticationContext(authURL);
         context.acquireTokenWithClientCredentials(resource, clientID, secret, function (err, tokenResponse) {
            if (err) {
               callback(new AzureError('err generate token-' + err));
               return;
            }
            else {
               Authentication.token = tokenResponse.accessToken;
               Authentication.expiresOn = tokenResponse.expiresOn.valueOf()
               callback(null, tokenResponse.accessToken);
            }
         });

      }
   };


   function azurePostPutRequest(method, reqSettings, callback) {
      var Settings, Authorization;

      getAuthenticationToken(reqSettings.regionContext, function (err, result) {
         if (err) {
            callback(new AzureError(err));
            return;
         }
         Authorization = result;
         Settings = {
            method: method,
            url: reqSettings.url,

            headers: {
               Authorization: 'Bearer '+Authorization,
               'Content-Type': 'application/json'
            },
            body: JSON.stringify(reqSettings.jsonBody)
         };

         console.log('Settings-'+JSON.stringify(Settings))

         request(Settings, function (err, response, body) {

            console.log('I am here !!!!!!!!!!!!!!!!!!!!!!!!!!!11-'+ JSON.stringify(response));

            if (!response) {
               callback(new AzureError('response is not valid-' + err));
               return;
            }

            if (err || response.statusCode !== reqSettings.successCode) {

               callback(err || new AzureError('res.statusCode-' + response.statusCode + ' ' + response.body));
               return;

            }

            callback(response.body, true);

         });
      });
   }


   var that = {

      setProxy: function (proxyUrl) {
         tunnelingProxyURL = proxyUrl;
      },

      createRegionContext: function (regionAuthSettings, regionLimits) {

         return {
            subscriptionId: regionAuthSettings.subscriptionId,
            cloudRegion: regionAuthSettings.cloudRegion,
            limits: regionLimits,
            providerName: 'azure_v2',
            groupId: regionAuthSettings.groupId,
            tenantId: regionAuthSettings.tenantId,
            clientId: regionAuthSettings.clientId,
            secret: regionAuthSettings.secret

         };
      },

      createNode: function (settings, cloudServicesTestSettings, nodeIndex, callback) {
         var nodeName = 'nodeCreatedByStorm' + (new Date().valueOf()),
            settings = {
               regionContext: settings.regionContext,
               jsonBody: {
                  location: settings.regionContext.cloudRegion,
                  properties: {
                     publicIPAllocationMethod: 'Dynamic',
                     idleTimeoutInMinutes: 4
                  }
               },
               url: 'https://management.azure.com/subscriptions/' + settings.regionContext.subscriptionId + '/resourceGroups/' + settings.regionContext.groupId + '/providers/Microsoft.Network/publicIPAddresses/' + nodeName + '?api-version=' + xMsVersion,
               successCode: 201
            }

         azurePostPutRequest('PUT', settings, function(err,res){

            console.log('res-'+res)

         });


      }


   };
   return that;
})();
