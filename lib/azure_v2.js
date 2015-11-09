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
               Authorization: 'Bearer ' + Authorization,
               'Content-Type': 'application/json'
            },
            body: JSON.stringify(reqSettings.jsonBody)
         };

         console.log('Settings-' + JSON.stringify(Settings))

         request(Settings, function (err, response, body) {

            console.log('I am here !!!!!!!!!!!!!!!!!!!!!!!!!!!11-' + JSON.stringify(response));

            if (!response) {
               callback(new AzureError('response is not valid-' + err));
               return;
            }

            if (err || response.statusCode !== reqSettings.successCode) {

               callback(err || new AzureError('res.statusCode-' + response.statusCode + ' ' + response.body));
               return;

            }

            callback(null, response.statusCode);
            return;

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
            secret: regionAuthSettings.secret,
            imagesContainer:regionAuthSettings.imagesContainer,
            vhdsContainer:regionAuthSettings.vhdsContainer

         };
      },

      createNode: function (settings, cloudServicesTestSettings, nodeIndex, callback) {

         // create public ip
         var nodeName = 'nodeCreatedByStorm' + (new Date().valueOf()),
            settingsIp = {
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
            }, settingsNetwork,settingsVm,userData,resultNode ;

         azurePostPutRequest('PUT', settingsIp, function (err, res) {

            if (err) {
               callback(err);
               return;
            }
            // create network interface card
            settingsNetwork = {
               regionContext: settings.regionContext,
               jsonBody: {
                  location: settings.regionContext.cloudRegion,
                  properties: {
                     ipConfigurations: [
                        {
                           name: nodeName,
                           properties: {
                              subnet: {
                                 id: '/subscriptions/' + settings.regionContext.subscriptionId + '/resourceGroups/' + settings.regionContext.groupId + '/providers/Microsoft.Network/virtualNetworks/' + settings.regionContext.groupId + '/subnets/default'
                              },
                              privateIPAllocationMethod: 'Dynamic',
                              'publicIPAddress': {
                                 'id': '/subscriptions/' + settings.regionContext.subscriptionId + '/resourceGroups/' + settings.regionContext.groupId + '/providers/Microsoft.Network/publicIPAddresses/' + nodeName
                              }
                           }
                        }
                     ]
                  }
               },
               url: 'https://management.azure.com/subscriptions/' + settings.regionContext.subscriptionId + '/resourceGroups/' + settings.regionContext.groupId + '/providers/Microsoft.Network/networkInterfaces/' + nodeName + '?api-version=' + xMsVersion,
               successCode: 201

            };



            azurePostPutRequest('PUT', settingsNetwork, function (err, res) {

               if (err) {
                  callback(err);
                  return;
               }

               // create virtual machine

               if (settings.nodeParams.userData) {
                  userData = new Buffer(JSON.stringify(settings.nodeParams.userData)).toString('base64');
               }

               else {
                  userData = 'IHt9';
               }

               settingsVm={
                  regionContext: settings.regionContext,
                  jsonBody: {
                     id: '/subscriptions/' + settings.regionContext.subscriptionId + '/resourceGroups/' + settings.regionContext.groupId + '/providers/Microsoft.Compute/virtualMachines/'+nodeName,
                     name: nodeName,
                     type: 'Microsoft.Compute/virtualMachines',
                     location: settings.regionContext.cloudRegion,
                     tags: settings.nodeParams.tags,
                     properties: {
                        hardwareProfile: {
                           vmSize: settings.nodeParams.instanceType
                        },
                        storageProfile: {
                           osDisk: {
                              osType: 'Linux',
                              name: 'VM5_img-osDisk.d550bcbc-9a2c-4c15-941c-41afaf9c1ad7.vhd',
                              image: {
                                 uri:settings.regionContext.imagesContainer+settings.nodeParams.imageId
                              },
                              vhd: {
                                 uri: settings.regionContext.vhdsContainer+nodeName+'.vhd'
                              },
                              caching: 'ReadWrite',
                              createOption: 'FromImage'
                           }
                        },
                        osProfile: {
                           computerName: nodeName,
                           adminUsername: 'ubuntu',
                           adminPassword: 'Storm-123',
                           customData: userData,
                           linuxConfiguration: {
                              disablePasswordAuthentication: false
                           }
                        },
                        networkProfile: {
                           networkInterfaces: [
                              {
                                 id: '/subscriptions/' + settings.regionContext.subscriptionId + '/resourceGroups/' + settings.regionContext.groupId + '/providers/Microsoft.Network/networkInterfaces/'+nodeName
                              }
                           ]
                        }
                     }
                  },
                  url: 'https://management.azure.com/subscriptions/' + settings.regionContext.subscriptionId + '/resourceGroups/' + settings.regionContext.groupId + '/providers/Microsoft.Compute/virtualMachines/' + nodeName + '?api-version=' + xMsVersion,
                  successCode: 201

               };

               azurePostPutRequest('PUT',  settingsVm, function (err, res) {

                  if (err) {
                     callback(err);
                     return;
                  }

                  var resultNode = {rawResult: 'node-' + nodeName + ' was created.', node: {id: nodeName, status: 'Starting' , addresses: null, tags: settings.nodeParams.tags}};

                  callback(null, resultNode);


               });

            });

         });

      },

      listNodes: function (settings, callback) {

         var finalResults = {rawResult: {}, nodes: []}, azureStorage;


      }


      };
   return that;
})();
