'use strict';

var request = require('request'),
   underscore = require('underscore'),
   xMsVersion = '2015-05-01-preview',
   AzureError = require('./azure-error'),
   Authentication = {},
   adal = require('adal-node'),
   tunnelingProxyURL,
   interval = 10000,
   azure = require('azure-storage');


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


   function azureRetryRequest(method, reqSettings, pollingCount, interval, callback) {

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


         request(Settings, function (err, response, body) {

            if (!response) {
               callback(new AzureError('response is not valid-' + err));
               return;
            }

            // in case of retry code and there we didn't reached to max polling

            if (pollingCount > 0 && underscore.contains(reqSettings.retryCodes, response.statusCode) === true) {


               setTimeout(azureRetryRequest, interval, method, reqSettings, pollingCount - 1, interval, callback);
            }

            // in case we got an error code which is not success/retry

            if ((pollingCount === 0 && underscore.contains(reqSettings.retryCodes, response.statusCode) === true) || (err || underscore.contains(reqSettings.successCode, response.statusCode) === false) && underscore.contains(reqSettings.retryCodes, response.statusCode) === false) {
               callback(err || new AzureError('res.statusCode-' + response.statusCode + ' ' + response.body));
               return;
            }
            if (underscore.contains(reqSettings.successCode, response.statusCode) === true) {

               if (method.toUpperCase() === 'DELETE') {
                  callback(null, reqSettings.successCode);
                  return;
               }
               else {
                  callback(null, JSON.parse(response.body));
                  return;
               }
            }

         });

      });
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


         request(Settings, function (err, response, body) {

            if (!response) {
               callback(new AzureError('response is not valid-' + err));
               return;
            }

            if (err || response.statusCode !== reqSettings.successCode) {

               callback(err || new AzureError('res.statusCode-' + response.statusCode + ' ' + response.body));
               return;

            }

            if (method.toUpperCase() === 'DELETE') {
               callback(null, reqSettings.successCode);
               return;
            }
            else {
               callback(null, JSON.parse(response.body));
               return;
            }

         });
      });
   };


   function deleteBlob(regionContext, container, Blob, pollingCount, interval, callback) {

      var blobSvc = azure.createBlobService(regionContext.storageAccount, regionContext.storageAccessKey);

      blobSvc.deleteBlob(container, Blob, function (error, response) {

         if (!response) {
            callback(new AzureError('delete blob response is not valid-' + err));
            return;
         }

         // in case of retry code and there we didn't reached to max polling

         if (pollingCount > 0 && response.statusCode === 412) {

            setTimeout(deleteBlob, interval, regionContext, container, Blob, pollingCount - 1, interval, callback);
         }

         // in case we got an error code which is not success/retry

         if ((pollingCount === 0 && response.statusCode === 412) || (response.statusCode != 412 && response.statusCode != 202)) {

            callback(err || new AzureError('error delete blob res.statusCode-' + response.statusCode + ' ' + response.body));
            return;
         }
         if (response.statusCode === 202) {

            callback(null, response.statusCode);
            return;

         }

      });

   };


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
            imagesContainer: regionAuthSettings.imagesContainer,
            vhdsContainer: regionAuthSettings.vhdsContainer,
            storageAccount: regionAuthSettings.storageAccount,
            storageAccessKey: regionAuthSettings.storageAccessKey,
            keyData: regionAuthSettings.keyData
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
            }, settingsNetwork, settingsVm, userData, resultNode;

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
                     networkSecurityGroup:{
                        id: '/subscriptions/' + settings.regionContext.subscriptionId + '/resourceGroups/' + settings.regionContext.groupId + '/providers/Microsoft.Network/networkSecurityGroups/'+settings.nodeParams.securityGroup
                     },
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

               settingsVm = {
                  regionContext: settings.regionContext,
                  jsonBody: {
                     id: '/subscriptions/' + settings.regionContext.subscriptionId + '/resourceGroups/' + settings.regionContext.groupId + '/providers/Microsoft.Compute/virtualMachines/' + nodeName,
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
                                 uri: settings.regionContext.imagesContainer + settings.nodeParams.imageId
                              },
                              vhd: {
                                 uri: settings.regionContext.vhdsContainer + nodeName + '.vhd'
                              },
                              caching: 'ReadWrite',
                              createOption: 'FromImage'
                           }
                        },
                        osProfile: {
                           computerName: nodeName,
                           adminUsername: 'ubuntu',
                           customData: userData,
                           linuxConfiguration: {
                              disablePasswordAuthentication: true,
                              ssh: {
                                 "publicKeys": [
                                    {
                                       "path": "/home/ubuntu/.ssh/authorized_keys",
                                       "keyData": settings.regionContext.keyData
                                    }
                                 ]
                              }
                           }
                        },
                        networkProfile: {
                           networkInterfaces: [
                              {
                                 id: '/subscriptions/' + settings.regionContext.subscriptionId + '/resourceGroups/' + settings.regionContext.groupId + '/providers/Microsoft.Network/networkInterfaces/' + nodeName
                              }
                           ]
                        }
                     }
                  },
                  url: 'https://management.azure.com/subscriptions/' + settings.regionContext.subscriptionId + '/resourceGroups/' + settings.regionContext.groupId + '/providers/Microsoft.Compute/virtualMachines/' + nodeName + '?api-version=' + xMsVersion,
                  successCode: 201

               };

               azurePostPutRequest('PUT', settingsVm, function (err, res) {

                  if (err) {
                     callback(err);
                     return;
                  }

                  var resultNode = {rawResult: 'node-' + nodeName + ' was created.', node: {id: nodeName, status: 'Starting', addresses: null, tags: settings.nodeParams.tags}};

                  callback(null, resultNode);


               });

            });

         });

      },

      listNodes: function (settings, callback) {

         var finalResults = {rawResult: {}, nodes: []}, azureStorage,
            settingsListVms = {
               regionContext: settings.regionContext,
               url: 'https://management.azure.com/subscriptions/' + settings.regionContext.subscriptionId + '/resourceGroups/' + settings.regionContext.groupId + '/providers/Microsoft.Compute/virtualMachines?api-version=' + xMsVersion,
               successCode: 200
            },
            settingsNetworkInterfaces = {
               regionContext: settings.regionContext,
               url: 'https://management.azure.com/subscriptions/' + settings.regionContext.subscriptionId + '/resourceGroups/' + settings.regionContext.groupId + '/providers/Microsoft.Network/networkInterfaces?api-version=' + xMsVersion,
               successCode: 200
            },
            settingsPublicIpAddresses = {
               regionContext: settings.regionContext,
               url: 'https://management.azure.com/subscriptions/' + settings.regionContext.subscriptionId + '/resourceGroups/' + settings.regionContext.groupId + '/providers/Microsoft.Network/publicIPAddresses?api-version=' + xMsVersion,
               successCode: 200
            }

         azurePostPutRequest('GET', settingsListVms, function (err, resListVms) {

            if (err) {
               callback(err);
               return;
            }

            azurePostPutRequest('GET', settingsNetworkInterfaces, function (err, resListNetworkInterfaces) {

               if (err) {
                  callback(err);
                  return;
               }


               azurePostPutRequest('GET', settingsPublicIpAddresses, function (err, resListIpAddresses) {

                  if (err) {
                     callback(err);
                     return;
                  }

                  underscore.each(resListVms.value, function (vm) {

                     var node = {
                        id: vm.name,
                        status: (vm.properties.provisioningState === 'Succeeded' ? 'ACTIVE' : vm.properties.provisioningState),
                        addresses: [underscore.filter(resListNetworkInterfaces.value, function (network) {
                           return network.id === vm.properties.networkProfile.networkInterfaces[0].id
                        })[0].properties.ipConfigurations[0].properties.privateIPAddress,


                           underscore.filter(resListIpAddresses.value, function (ip) {
                              return ip.id === underscore.filter(resListNetworkInterfaces.value, function (network) {
                                 return network.id === vm.properties.networkProfile.networkInterfaces[0].id
                              })[0].properties.ipConfigurations[0].properties.publicIPAddress.id

                           })[0].properties.ipAddress

                        ],
                        tags: vm.tags
                     }

                     finalResults.nodes.push(node)
                  });
                  finalResults.rawResult = resListVms;
                  callback(null, finalResults);

               });
            });
         });

      },

      deleteNode: function (settings, callback) {
         var settingsGetVm = {
               regionContext: settings.regionContext,
               url: 'https://management.azure.com/subscriptions/' + settings.regionContext.subscriptionId + '/resourceGroups/' + settings.regionContext.groupId + '/providers/Microsoft.Compute/virtualMachines/' + settings.node.id + '?api-version=' + xMsVersion,
               successCode: 200
            } ,
            settingsDelVm = {
               regionContext: settings.regionContext,
               url: 'https://management.azure.com/subscriptions/' + settings.regionContext.subscriptionId + '/resourceGroups/' + settings.regionContext.groupId + '/providers/Microsoft.Compute/virtualMachines/' + settings.node.id + '?api-version=' + xMsVersion,
               successCode: 202
            } , settingsdelNetwork , settingsdelIp = {
               regionContext: settings.regionContext,
               url: 'https://management.azure.com/subscriptions/' + settings.regionContext.subscriptionId + '/resourceGroups/' + settings.regionContext.groupId + '/providers/Microsoft.Network/publicIPAddresses/' + settings.node.id + '?api-version=' + xMsVersion,
               successCode: 202

            }, vmNic, vmOsDisc;

         azurePostPutRequest('GET', settingsGetVm, function (err, resVm) {

            if (err) {
               callback(err);
               return;
            }

            vmNic = resVm.properties.networkProfile.networkInterfaces[0].id.substring(resVm.properties.networkProfile.networkInterfaces[0].id.lastIndexOf('/') + 1);
            vmOsDisc = resVm.properties.storageProfile.osDisk.vhd.uri.substring(resVm.properties.storageProfile.osDisk.vhd.uri.lastIndexOf('/') + 1);

            settingsdelNetwork = {
               regionContext: settings.regionContext,
               url: 'https://management.azure.com/subscriptions/' + settings.regionContext.subscriptionId + '/resourceGroups/' + settings.regionContext.groupId + '/providers/Microsoft.Network/networkInterfaces/' + vmNic + '?api-version=' + xMsVersion,
               successCode: [202],
               retryCodes: [400]

            }


            azurePostPutRequest('DELETE', settingsDelVm, function (err, resVm) {

               if (err) {
                  callback(err);
                  return;
               }

               deleteBlob(settings.regionContext, 'vhds',vmOsDisc, 20, interval,  function (err, res) {

                  if (err) {
                     callback(err);
                     return;
                  }

                  azureRetryRequest('DELETE', settingsdelNetwork, 20, interval, function (err, resVm) {

                     if (err) {
                        callback(err);
                        return;
                     }


                     azurePostPutRequest('DELETE', settingsdelIp, function (err, resVm) {

                        if (err) {
                           callback(err);
                           return;
                        }

                        callback(null, true);
                        return;

                     });
                  });
               });
            });
         });
      }

   };
   return that;
})
   ();
