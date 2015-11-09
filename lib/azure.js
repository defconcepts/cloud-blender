'use strict';

var request = require('request'),
   underscore = require('underscore'),
   AzureError = require('./azure-error'),
   fs = require('fs'),
   url = require('url'),
   util = require('util'),
   xml2js = require('xml2js'),
   parseString = xml2js.parseString,
   interval = 2000,
   operationValidateInterval = 15000,
   xMsVersion = '2014-06-01',
   tunnelingProxyURL;

module.exports = (function () {
   var azureStorageInst;

   azureStorageInst = {};
   function getAzureStorage(regionCtx) {
      var instId;

      regionCtx = regionCtx || {};
      instId = util.format('%s_%s_%s',
         regionCtx.cloudRegion || '',
         regionCtx.storageAccount || '', 
         regionCtx.storageAccessKey || '');
      if (azureStorageInst[instId]) {
         return azureStorageInst[instId];
      }

      azureStorageInst[instId] = require('./azure_storage')({
         storageAccount: regionCtx.storageAccount,
         storageAccessKey: regionCtx.storageAccessKey,
         host: (function () {
            var storageAcc;

            if (regionCtx.cloudRegion !== 'China East' &&
                regionCtx.cloudRegion !== 'China North') {
               return undefined;
            }

            storageAcc = regionCtx.storageAccount;
            if (!storageAcc) {
               return {
                  primaryHost: url.format({
                     protocol: 'https:',
                     host: 'table.core.chinacloudapi.cn' }),
                  secondaryHost: url.format({
                     protocol: 'https:',
                     host: 'table.core.chinacloudapi.cn' })
               };
            }
            return {
               primaryHost: url.format({
                  protocol: 'https:',
                  host: storageAcc + '.table.core.chinacloudapi.cn' }),
               secondaryHost: url.format({
                  protocol: 'https:',
                  host: storageAcc +
                        '-secondary.table.core.chinacloudapi.cn' }),
            };
         })()
      });
      return azureStorageInst[instId];
   }

   function azureRetryDeleteRequest(settings, pollingCount, interval, callback) {


      var deleteRequestSettings = {
         method: 'DELETE',
         headers: {
            'x-ms-version': settings.xMsVersion
         },

         url: settings.url,
         cert: settings.azureCert,
         key: settings.azureKey
      };

      request(deleteRequestSettings, function (err, res, body) {

         if (!res){
            callback(new AzureError('response is not valid-'+err));
            return;
         }

         // in case of retry code and there we didn't reached to max polling

         if (pollingCount > 0 && underscore.contains(settings.retryCodes, res.statusCode) === true) {
            setTimeout(azureRetryDeleteRequest, interval, settings, pollingCount - 1, interval, callback);
         }

         // in case owe got an error code which is not success/retry

         if ((err || underscore.contains(settings.successCode, res.statusCode) === false) && underscore.contains(settings.retryCodes, res.statusCode) === false) {
            callback(err || new AzureError('res.statusCode-' + res.statusCode + ' ' + res.body));
            return;
         }
         if (underscore.contains(settings.successCode, res.statusCode) === true) {
            callback(null, res.statusCode);
            return;
         }

      });

   }

   function azureRetryRequest(settings, pollingCount, interval, callback) {


      request[settings.restType]({
         uri: settings.url,

         headers: {
            'x-ms-version': settings.xMsVersion,
            'Content-Type': 'application/xml'
         },

         cert: settings.azureCert,
         key:  settings.azureKey,
         body: settings.xmlBody

      }, function (err, res, body) {

         if (!res){
            callback(new AzureError('response is not valid-'+err));
            return;
         }

         // in case of retry code and there we didn't reached to max polling

         if (pollingCount > 0 && underscore.contains(settings.retryCodes, res.statusCode) === true) {
            setTimeout(azureRetryRequest, interval, settings, pollingCount - 1, interval, callback);
         }


         // in case owe got an error code which is not success/retry

         if ((err || underscore.contains(settings.successCode, res.statusCode) === false) && underscore.contains(settings.retryCodes, res.statusCode) === false) {
            callback(err || new AzureError('res.statusCode-' + res.statusCode + ' ' + res.body));
            return;
         }
         if (underscore.contains(settings.successCode, res.statusCode) === true) {
            callback(null, res);
            return;
         }

      });

   }


   function azureValidateRetryRequest(ctx, settings, pollingCount, interval, callback) {


      request[settings.restType]({
         uri: settings.url,

         headers: {
            'x-ms-version': settings.xMsVersion,
            'Content-Type': 'application/xml'
         },

         cert: settings.azureCert,
         key: settings.azureKey,
         body: settings.xmlBody

      }, function (err, res, body) {

         if (res) {

            // in case owe got an error code which is not success/retry

            if ((err || underscore.contains(settings.successCode, res.statusCode) === false) && underscore.contains(settings.retryCodes, res.statusCode) === false) {
               callback(err || new AzureError('res.statusCode-' + res.statusCode + ' ' + res.body), {});
               return;
            }

            else {
               azureGetOpertionStatus(ctx, settings, res.headers['x-ms-request-id'], 15, operationValidateInterval, function (errStatus, resultStatus) {

                  // in case of retry code and there we didn't reached to max polling  or status code is success and the operation failed.

                  if ((pollingCount > 0 && underscore.contains(settings.retryCodes, res.statusCode) === true) || (pollingCount > 0 && underscore.contains(settings.successCode, res.statusCode) === true && resultStatus === 'Failed')) {
                     setTimeout(azureValidateRetryRequest, interval, ctx, settings, pollingCount - 1, interval, callback);
                  }


                  // in case both ter rest and the operation Succeeded

                  if (underscore.contains(settings.successCode, res.statusCode) === true && resultStatus === 'Succeeded') {
                     callback(null, res);
                     return;
                  }

               });
            }
         }
         else {
            setTimeout(azureValidateRetryRequest, interval, ctx, settings, pollingCount - 1, interval, callback);
         }
      });
   }


   function azureGetOpertionStatus(ctx, settings, requestId, pollingCount, interval, callback) {


      var getSettings = {
         url: 'https://' + ctx.regionContext.apiPrefix + '/' +
              settings.subscriptionId + '/operations/' + requestId,
         xMsVersion: settings.xMsVersion,
         azureCert: settings.azureCert,
         azureKey: settings.azureKey,
         successCode: 200
      };

      azureGetRequest(getSettings, function (errGet, resultGet) {

         if (!resultGet){
            callback(new AzureError('response is not valid-'+errGet));
            return;
         }

         // in case the status is still in InProgress or missing result

         if ((pollingCount > 0 && !resultGet) || (pollingCount > 0 && resultGet.Operation.Status[0] === 'InProgress')) {
            setTimeout(azureGetOpertionStatus, interval, ctx, settings, requestId, pollingCount - 1, interval, callback);
         }


         // in case  pollingCount=0 or status ='Failed'

         if ((pollingCount === 0 && !resultGet) || errGet || resultGet.Operation.Status[0] === 'Failed' || (pollingCount === 0 && resultGet.Operation.Status[0] !== 'Succeeded')) {
            callback(errGet || 'Failed', 'Failed');
            return;
         }

         // in case  of Status = 'Succeeded'
         if (resultGet.Operation.Status[0] === 'Succeeded') {
            callback(null, 'Succeeded');
            return;
         }

      });

   }


   function azureGetRequest(settings, callback) {

      var getSettings = {
         url: settings.url,

         headers: {
            'x-ms-version': settings.xMsVersion
         },
         cert: settings.azureCert,
         key: settings.azureKey
      };


      request(getSettings, function (err, response, body) {

         if (!response){
            callback(new AzureError('response is not valid-'+err));
            return;
         }

         if (err || response.statusCode !== settings.successCode) {

            callback(err || new AzureError('res.statusCode-' + response.statusCode + ' ' + response.body));
            return;

         }

         parseString(response.body, function (err, result) {

            if (err) {
               callback(err);
               return;

            }
            callback(null, result);
         });
      });

   }


   function checkPollCloudServices(settings, subscriptionId, azureCert, azureKey, newServicesArr, pollingCount, interval, callback) {

      var getSettings = {
         url: 'https://' + settings.regionContext.apiPrefix + '/' +
              subscriptionId + '/services/hostedservices',
         xMsVersion: xMsVersion,
         azureCert: azureCert,
         azureKey: azureKey,
         successCode: 200
      };

      azureGetRequest(getSettings, function (err, result) {

         // in case of err
         if (err) {
            if (pollingCount === 0) {
               callback(new AzureError('max polling for cloud services'));
               return;
            }

            else {
               setTimeout(checkPollCloudServices, interval, settings, subscriptionId, azureCert, azureKey, newServicesArr, pollingCount - 1, interval, callback);
            }


         }
         // extract an array of all services names which where created
         else {
            // extract an array of all services names which where created

            var services = underscore.flatten(underscore.pluck(underscore.filter(result.HostedServices.HostedService, function (service) {
               return service.HostedServiceProperties[0].Status[0] === 'Created';
            }), 'ServiceName'));


            if (underscore.difference(newServicesArr, services).length === 0) {
               callback(null, true);
               return;
            }
            else {

               if (pollingCount === 0) {
                  callback(new AzureError('max polling for cloud services'));
                  return;
               }

               else {
                  setTimeout(checkPollCloudServices, interval, settings, subscriptionId, azureCert, azureKey, newServicesArr, pollingCount - 1, interval, callback);
               }
            }
         }
      });

   }

   function createCLoudServices(settings, callback) {


      var numberOfServices = Math.ceil((settings.nodes.length / settings.regionContext.limits.maxRolesPerService)),
         numberOfVms = settings.nodes.length,
         cloudServices = [],
         callbackIndex = 0,
         errors = [];

      for (var i = 1; i <= numberOfServices; i++) {


         var serviceName = 'serviceCreatedByStorm' + i + (new Date().valueOf()),
            xmlBody = '<CreateHostedService xmlns="http://schemas.microsoft.com/windowsazure" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">' +
               '<ServiceName>' + serviceName + '</ServiceName>' +
               '<Label>1234</Label>' +
               '<Description>description-of-cloud-service</Description>' +
               '<Location>' + settings.regionContext.cloudRegion + '</Location>' +
               '<ExtendedProperties>' +
               '<ExtendedProperty>' +
               '<Name>' + serviceName + '</Name>' +
               '</ExtendedProperty>' +
               '</ExtendedProperties>' +
               '</CreateHostedService>';


         cloudServices.push({id: serviceName, minIndex: (settings.regionContext.limits.maxRolesPerService * (i - 1)), maxIndex: ((settings.regionContext.limits.maxRolesPerService * (i) > numberOfVms) ? numberOfVms - 1 : (settings.regionContext.limits.maxRolesPerService * (i)) - 1)});


         var postSettings = {
            url: 'https://' + settings.regionContext.apiPrefix + '/' +
                 settings.regionContext.subscriptionId + '/services/hostedservices',
            xMsVersion: xMsVersion,
            azureCert: settings.regionContext.azureCert,
            azureKey: settings.regionContext.azureKey,
            successCode: [201],
            xmlBody: xmlBody,
            retryCodes: [307],
            restType: 'post'
         };

         azureRetryRequest(postSettings, 40, interval, function (err, result) {


            if (err) {
               errors.push(err);
            }

            callbackIndex += 1;


            if (callbackIndex === numberOfServices) {

               if (errors.length > 0) {
                  callback(errors);
                  return;
               }

               checkPollCloudServices(settings, settings.regionContext.subscriptionId, settings.regionContext.azureCert, settings.regionContext.azureKey, underscore.pluck(cloudServices, 'id'), 20, interval, function (err, res) {
                  if (err) {
                     callback(err);
                     return;
                  }

                  callback(null, cloudServices);

               });


            }

         });


      }

   }

   function uploadCLoudServiceCertificate(settings, cloudService, callback) {

      var pemFile = settings.regionContext.azureSshPem,
         xmlBody = '<CertificateFile xmlns="http://schemas.microsoft.com/windowsazure">' +
            '<Data>' + pemFile + '</Data>' +
            '<CertificateFormat>pfx</CertificateFormat>' +
            '<Password></Password>' +
            '</CertificateFile>',
         postSettings = {
            url: 'https://' + settings.regionContext.apiPrefix + '/' +
                 settings.regionContext.subscriptionId +
                 '/services/hostedservices/' + cloudService + '/certificates',
            xMsVersion: xMsVersion,
            azureCert: settings.regionContext.azureCert,
            azureKey: settings.regionContext.azureKey,
            successCode: [202],
            xmlBody: xmlBody,
            retryCodes: [307, 409],
            restType: 'post'
         };

      azureRetryRequest(postSettings, 40, interval, function (err, result) {
         if (err) {
            callback(err);
            return;
         }

         callback(null, result);

      });

   }


   function createCLoudDeployment(settings, cloudService, servicesIndex, callback) {

      uploadCLoudServiceCertificate(settings, cloudService.id, function (err, res) {

         if (err) {
            callback(err);
            return;
         }

         var vmImageName = settings.nodes[servicesIndex * settings.regionContext.limits.maxRolesPerService].imageId,
            instanceType = settings.nodes[servicesIndex * settings.regionContext.limits.maxRolesPerService].instanceType,
            userData,
            deploymentName = 'deploymentCreatedByStorm' + (new Date().valueOf()),
            nodeName = 'nodeCreatedByStorm' + (new Date().valueOf()),
            postSettings,
            cloudServiceSetting
            ;


         if (settings.nodes[servicesIndex * settings.regionContext.limits.maxRolesPerService].userData) {

            userData = new Buffer(JSON.stringify(settings.nodes[servicesIndex * settings.regionContext.limits.maxRolesPerService].userData)).toString('base64');
         }

         else {
            userData = 'IHt9';
         }


         getImageOsType(settings, vmImageName, function (err, res) {
            var xmlBody, azureStorage;
            if (err) {
               callback(err);
               return;
            }
            azureStorage = getAzureStorage(settings.regionContext);
            if (res === 'Linux') {

               xmlBody = '<Deployment xmlns="http://schemas.microsoft.com/windowsazure" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">' +
                  '<Name>' + deploymentName + '</Name>' +
                  '<DeploymentSlot>Production</DeploymentSlot>' +
                  '<Label>' + deploymentName + '</Label>' +
                  '<RoleList>' +
                  '<Role i:type="PersistentVMRole">' +
                  '<RoleName>' + nodeName + '</RoleName>' +
                  '<RoleType>PersistentVMRole</RoleType>' +
                  '<ConfigurationSets><ConfigurationSet i:type="LinuxProvisioningConfigurationSet">' +
                  '<ConfigurationSetType>LinuxProvisioningConfiguration</ConfigurationSetType>' +
                  '<HostName>' + nodeName + '</HostName>' +
                  '<UserName>ubuntu</UserName>' +
                  '<UserPassword></UserPassword>' +
                  '<DisableSshPasswordAuthentication>true</DisableSshPasswordAuthentication>' +
                  '<SSH>' +
                  '<PublicKeys>' +
                  '<PublicKey>' +
                  '<Fingerprint>' + settings.regionContext.azureFingerPrint + '</Fingerprint>' +
                  '<Path>/home/azureuser/.ssh/authorized_keys</Path>' +
                  '</PublicKey>' +
                  '</PublicKeys>' +
                  '<KeyPairs>' +
                  '<KeyPair>' +
                  '<Fingerprint>' + settings.regionContext.azureFingerPrint + '</Fingerprint>' +
                  '<Path>/home/azureuser/.ssh/id_rsa</Path>' +
                  '</KeyPair>' +
                  '</KeyPairs>' +
                  '</SSH>' +
                  '<CustomData>' + userData + '</CustomData>' +
                  '</ConfigurationSet>' +
                  '<ConfigurationSet>' +
                  '<ConfigurationSetType>NetworkConfiguration</ConfigurationSetType>' +
                  '<InputEndpoints>' +
                  '<InputEndpoint>' +
                  '<LocalPort>22</LocalPort>' +
                  '<Name>SSH</Name>' +
                  '<Port>22</Port>' +
                  '<Protocol>TCP</Protocol>' +
                  '</InputEndpoint>' +
                  '<InputEndpoint>' +
                  '<LocalPort>35358</LocalPort>' +
                  '<Name>PORT1</Name>' +
                  '<Port>35358</Port>' +
                  '<Protocol>TCP</Protocol>' +
                  '</InputEndpoint>' +
                  '<InputEndpoint>' +
                  '<LocalPort>35357</LocalPort>' +
                  '<Name>PORT2</Name>' +
                  '<Port>35357</Port>' +
                  '<Protocol>TCP</Protocol>' +
                  '</InputEndpoint>' +
                  '<InputEndpoint>' +
                  '<LocalPort>6500</LocalPort>' +
                  '<Name>PORT3</Name>' +
                  '<Port>6500</Port>' +
                  '<Protocol>TCP</Protocol>' +
                  '</InputEndpoint>' +
                  '<InputEndpoint>' +
                  '<LocalPort>6600</LocalPort>' +
                  '<Name>PORT4</Name>' +
                  '<Port>6600</Port>' +
                  '<Protocol>TCP</Protocol>' +
                  '</InputEndpoint>' +
                  '</InputEndpoints>' +
                  '</ConfigurationSet>' +
                  '</ConfigurationSets>' +
                  '<VMImageName>' + vmImageName + '</VMImageName>' +
                  '<RoleSize>' + instanceType + '</RoleSize>' +
                  '</Role>' +
                  '</RoleList>' +
                  '</Deployment>';
            }

            else if (res === 'Windows') {
               xmlBody = '<Deployment xmlns="http://schemas.microsoft.com/windowsazure" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">' +
                  '<Name>' + deploymentName + '</Name>' +
                  '<DeploymentSlot>Production</DeploymentSlot>' +
                  '<Label>' + deploymentName + '</Label>' +
                  '<RoleList>' +
                  '<Role i:type="PersistentVMRole">' +
                  '<RoleName>' + nodeName + '</RoleName>' +
                  '<RoleType>PersistentVMRole</RoleType>' +
                  '<ConfigurationSets>' +
                  '<ConfigurationSet>' +
                  '<ConfigurationSetType>WindowsProvisioningConfiguration</ConfigurationSetType>' +
                  '<ComputerName>storm</ComputerName>' +
                  '<AdminPassword>'+settings.regionContext.azureWindowsRdpPass+'</AdminPassword>' +
                  '<EnableAutomaticUpdates>false</EnableAutomaticUpdates>' +
                  '<AdminUsername>ubuntu</AdminUsername>' +
                  '<CustomData>' + userData + '</CustomData>' +
                  '</ConfigurationSet>' +
                  '<ConfigurationSet>' +
                  '<ConfigurationSetType>NetworkConfiguration</ConfigurationSetType>' +
                  '<InputEndpoints>' +
                  '<InputEndpoint>' +
                  '<LocalPort>22</LocalPort>' +
                  '<Name>SSH</Name>' +
                  '<Port>22</Port>' +
                  '<Protocol>TCP</Protocol>' +
                  '</InputEndpoint>' +
                  '<InputEndpoint>' +
                  '<LocalPort>35358</LocalPort>' +
                  '<Name>PORT1</Name>' +
                  '<Port>35358</Port>' +
                  '<Protocol>TCP</Protocol>' +
                  '</InputEndpoint>' +
                  '<InputEndpoint>' +
                  '<LocalPort>35357</LocalPort>' +
                  '<Name>PORT2</Name>' +
                  '<Port>35357</Port>' +
                  '<Protocol>TCP</Protocol>' +
                  '</InputEndpoint>' +
                  '<InputEndpoint>' +
                  '<LocalPort>6500</LocalPort>' +
                  '<Name>PORT3</Name>' +
                  '<Port>6500</Port>' +
                  '<Protocol>TCP</Protocol>' +
                  '</InputEndpoint>' +
                  '<InputEndpoint>' +
                  '<LocalPort>6600</LocalPort>' +
                  '<Name>PORT4</Name>' +
                  '<Port>6600</Port>' +
                  '<Protocol>TCP</Protocol>' +
                  '</InputEndpoint>' +
                  '<InputEndpoint>' +
                  '<LocalPort>3389</LocalPort>' +
                  '<Name>RDP</Name>' +
                  '<Port>3389</Port>' +
                  '<Protocol>TCP</Protocol>' +
                  '</InputEndpoint>' +
                  '</InputEndpoints>' +
                  '</ConfigurationSet>' +
                  '</ConfigurationSets>' +
                  '<VMImageName>' + vmImageName + '</VMImageName>' +
                  '<RoleSize>' + instanceType + '</RoleSize>' +
                  '<ProvisionGuestAgent>true</ProvisionGuestAgent>' +
                  '</Role>' +
                  '</RoleList>' +
                  '</Deployment>';

            }

            postSettings = {
               url: 'https://' + settings.regionContext.apiPrefix + '/' +
                    settings.regionContext.subscriptionId +
                    '/services/hostedservices/' + cloudService.id + '/deployments',
               xMsVersion: xMsVersion,
               azureCert: settings.regionContext.azureCert,
               azureKey: settings.regionContext.azureKey,
               successCode: [202],
               xmlBody: xmlBody,
               retryCodes: [307, 409, 400, 503],
               restType: 'post',
               subscriptionId: settings.regionContext.subscriptionId

            };


            azureValidateRetryRequest(settings, postSettings, 15, operationValidateInterval, function (err, result) {

               if (err) {
                  cloudServiceSetting = {cloudService: cloudService.id, deployment: deploymentName, deploymentNode: {nodeName: nodeName, launchStatus: 'failed to create deployment', tags: settings.nodes[servicesIndex * settings.regionContext.limits.maxRolesPerService].tags}};
                  callback(err, cloudServiceSetting);
                  return;
               }

               cloudServiceSetting = {cloudService: cloudService.id, deployment: deploymentName, deploymentNode: {nodeName: nodeName, launchStatus: 'OK', tags: settings.nodes[servicesIndex * settings.regionContext.limits.maxRolesPerService].tags}};

               azureStorage.addNodeTagging(settings.regionContext.cloudRegion, nodeName, settings.nodes[servicesIndex * settings.regionContext.limits.maxRolesPerService].tags, 'OK', cloudServiceSetting, function (err, tagRetval) {

                  if (err) {
                     cloudServiceSetting = {cloudService: cloudService.id, deployment: deploymentName, deploymentNode: {nodeName: nodeName, launchStatus: 'failed to create node tag', tags: settings.nodes[servicesIndex * settings.regionContext.limits.maxRolesPerService].tags}};
                     callback('err add node tagging-' + err, cloudServiceSetting);
                     return;

                  }
                  callback(null, cloudServiceSetting);

               });

            });
         });
      });
   }


   function getCloudServicesByLocation(settings, callback) {
      var getSettings = {
         url: 'https://' + settings.regionContext.apiPrefix + '/' +
              settings.regionContext.subscriptionId + '/services/hostedservices',
         xMsVersion: xMsVersion,
         azureCert: settings.regionContext.azureCert,
         azureKey: settings.regionContext.azureKey,
         successCode: 200
      };

      azureGetRequest(getSettings, function (err, result) {

         if (err) {
            callback(err);
            return;
         }
         var services = underscore.flatten(underscore.pluck(underscore.filter(result.HostedServices.HostedService, function (service) {
            return (service.HostedServiceProperties[0].Status[0] === 'Created' && service.HostedServiceProperties[0].Location[0] === settings.regionContext.cloudRegion);
         }), 'ServiceName'));

         callback(null, services);

      });
   }

   function margeNodesLists(settings, storageNodes, nodesList, callback) {


      var azureStorage, finalResults = nodesList,
         numberOfTagsNodes = storageNodes.length,
         nodeTagsIndex = 0;
      
      azureStorage = getAzureStorage(settings.regionContext);
      if (numberOfTagsNodes === 0) {
         callback(null, nodesList);
      }

      underscore.forEach(storageNodes, function (nodeResult) {

         // check if the node exists already from rest API if not we will add it from the storage.

         if (underscore.contains(underscore.pluck(nodesList.nodes, 'id'), nodeResult.RowKey) === false) {

            if ((new Date()).getTime() > (Date.parse(nodeResult.Timestamp) + (1000 * 60 * 60 * 2))) {

               azureStorage.deleteTagging('node', nodeResult.PartitionKey, nodeResult.RowKey, function (err, deleteTagRetval) {

                  if (err) {
                     callback(err, {rawResult: 'failed to delete node-' + nodeResult.RowKey});
                     return;

                  }
               });

            }

            else {
               var tag = {};

               underscore.forEach(underscore.filter(underscore.keys(nodeResult), function (key) {
                  return key.indexOf('key') > -1;
               }), function (key) {
                  tag[nodeResult[key]] = nodeResult['values' + key.substring(4, key.length)];

               });


               var node = {
                  id: nodeResult.RowKey,
                  status: ((nodeResult.launchStatus === 'OK') ? 'Starting' : 'ERROR_' + nodeResult.launchStatus),
                  addresses: null,
                  tags: tag
               };

               finalResults.nodes.push(node);
            }
         }
         nodeTagsIndex += 1;

         if (nodeTagsIndex === numberOfTagsNodes) {

            callback(null, finalResults);

            return;
         }

      });


   }

   function margeImagesLists(settings, storageImages, imageList, callback) {
      var azureStorage, finalResults = imageList,
         numberOfTagsImages = storageImages.length,
         imageTagsIndex = 0;

      azureStorage = getAzureStorage(settings.regionContext);
      if (numberOfTagsImages === 0) {
         callback(null, imageList);
      }

      underscore.forEach(storageImages, function (imageResult) {

         // check if the node exists already from rest API if not we will add it from the storage.

         if (underscore.contains(underscore.pluck(imageList.images, 'id'), imageResult.RowKey) === false) {

            if ((new Date()).getTime() > (Date.parse(imageResult.Timestamp) + (1000 * 60 * 60 * 2))) {

               azureStorage.deleteTagging('image', imageResult.PartitionKey, imageResult.RowKey, function (err, deleteTagRetval) {

                  if (err) {
                     callback(err, {rawResult: 'failed to delete Image Tagging-' + imageResult.RowKey});
                     return;

                  }
               });

            }

            else {
               var tag = {};

               underscore.forEach(underscore.filter(underscore.keys(imageResult), function (key) {
                  return key.indexOf('key') > -1;
               }), function (key) {
                  tag[imageResult[key]] = imageResult['values' + key.substring(4, 5)];

               });


               var image = {
                  id: imageResult.RowKey,
                  status: 'starting',
                  tags: tag
               };

               finalResults.images.push(image);
            }
         }
         imageTagsIndex += 1;

         if (imageTagsIndex === numberOfTagsImages) {

            callback(null, finalResults);

            return;
         }

      });

   }

   function stopNode(settings, cloudService, deployment, node, pollingCount, interval, callback) {


      var xmlBody = '<ShutdownRoleOperation xmlns="http://schemas.microsoft.com/windowsazure" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">' +
            '<OperationType>ShutdownRoleOperation</OperationType>' +
            '</ShutdownRoleOperation>',
         postSettings = {
            url: 'https://' + settings.regionContext.apiPrefix + '/' +
                 settings.regionContext.subscriptionId + '/services/hostedservices/' +
                 cloudService + '/deployments/' + deployment +
                 '/roleinstances/' + node + '/Operations',
            xMsVersion: xMsVersion,
            azureCert: settings.regionContext.azureCert,
            azureKey: settings.regionContext.azureKey,
            successCode: [202],
            xmlBody: xmlBody,
            retryCodes: [307, 409],
            restType: 'post'
         };

      azureRetryRequest(postSettings, 40, interval, function (err, result) {
         if (err) {
            callback(err);
            return;
         }

         var getSettings = {
            url: 'https://' + settings.regionContext.apiPrefix + '/' +
                 settings.regionContext.subscriptionId + '/services/hostedservices/' +
                 cloudService + '/deployments/' + deployment,
            xMsVersion: xMsVersion,
            azureCert: settings.regionContext.azureCert,
            azureKey: settings.regionContext.azureKey,
            successCode: 200
         };

         azureGetRequest(getSettings, function (err, resultNode) {

               var nodeStatus = underscore.filter(resultNode.Deployment.RoleInstanceList[0].RoleInstance, function (noderec) {
                  return noderec.RoleName[0] === node;
               })[0].PowerState[0];


               if (err) {
                  callback(err);
                  return;

               }


               if (nodeStatus === 'Stopped') {

                  setTimeout(function () {
                     callback(null, true);
                     return;
                  }, 20000);
               }
               else {

                  if (pollingCount === 0) {
                     callback(new AzureError('max polling for stop Node'));
                     return;
                  }

                  else {

                     setTimeout(stopNode, interval, settings, cloudService, deployment, node, pollingCount - 1, interval, callback);
                  }
               }


            }
         )
         ;


      });

   }


   function getDeploymentNodeList(settings, cloudService, callback) {

      var azureStorage, DeploymentFinalResults = {nodes: []},
         getSettings = {
            url: 'https://' + settings.regionContext.apiPrefix + '/' +
                 settings.regionContext.subscriptionId + '/services/hostedservices/' +
                 cloudService + '/deploymentslots/Production',
            xMsVersion: xMsVersion,
            azureCert: settings.regionContext.azureCert,
            azureKey: settings.regionContext.azureKey,
            successCode: 200
         };

      azureStorage = getAzureStorage(settings.regionContext);
      azureGetRequest(getSettings, function (err, resultNodes) {

         var numberOfNodes,
            nodeIndex = 0,
            errors = [];


         if (resultNodes && resultNodes.Deployment.RoleInstanceList[0].RoleInstance) {


            var nodeList = resultNodes.Deployment.RoleInstanceList[0].RoleInstance;


            DeploymentFinalResults.rawResult = nodeList;

            numberOfNodes = nodeList.length;

            if (numberOfNodes === 0) {
               callback(null, DeploymentFinalResults);
               return;

            }


            underscore.forEach(nodeList, function (nodeResult) {


               azureStorage.getNodeTagging(settings.regionContext.cloudRegion, nodeResult.RoleName[0], function (err, tagRetval) {


                  var tagging, vIp;

                  if (err) {
                     // errors.push(err);
                     tagging = {};
                  }


                  if (!tagRetval) {
                     tagging = {};
                  }
                  else {
                     tagging = tagRetval.finalTagging;
                  }


                  if (nodeResult.InstanceEndpoints) {
                     vIp = nodeResult.InstanceEndpoints[0].InstanceEndpoint[0].Vip[0];

                  }

                  var node = {
                     id: nodeResult.RoleName[0],
                     status: ((nodeResult.PowerState[0] === 'Started' && (!nodeResult.GuestAgentStatus || (nodeResult.GuestAgentStatus && nodeResult.GuestAgentStatus[0].Status[0]==='Ready')))? 'ACTIVE' : nodeResult.PowerState[0]),
                     addresses: [(!nodeResult.IpAddress?null:nodeResult.IpAddress[0]), vIp],
                     tags: tagging
                  };

                  DeploymentFinalResults.nodes.push(node);

                  nodeIndex += 1;


                  if (nodeIndex === numberOfNodes) {
                     callback(underscore.without(errors, ''), DeploymentFinalResults);
                     return;

                  }


               });
            });
         }

         else {

            callback(null, DeploymentFinalResults);
            return;

         }


      });
   }


   function deleteService(settings, cloudService, deployment, callback) {

      getDeploymentNodeList(settings, cloudService, function (err, result) {
         if (err && (err[0])) {
            callback(err);
            return;
         }


         if (underscore.filter(result.nodes,function (node) {
            return (node.status !== 'Stopped');
         }).length === 0) {


            var DelSettings = {
               url: 'https://' + settings.regionContext.apiPrefix + '/' +
                    settings.regionContext.subscriptionId + '/services/hostedservices/' +
                    cloudService+'?comp=media',
               xMsVersion: xMsVersion,
               azureCert: settings.regionContext.azureCert,
               azureKey: settings.regionContext.azureKey,
               successCode: [202],
               retryCodes: [307, 409]
            };

            //  delete the image cloud service
            azureRetryDeleteRequest(DelSettings, 40, interval, function (err, delResService) {
               if (err) {
                  callback(err);
                  return;

               }
               callback(null, true);
               return;
            });

         }
         else {
            callback(null, true);
            return;
         }
      });
   }

   function getNodePIp(settings, cloudService, deployment, nodeId, pollingCount, interval, callback) {

      var nodeCheck,
         PIp,
         getSettings = {

            url: 'https://' + settings.regionContext.apiPrefix + '/' +
                 settings.regionContext.subscriptionId + '/services/hostedservices/' +
                 cloudService + '/deployments/' + deployment,
            xMsVersion: xMsVersion,
            azureCert: settings.regionContext.azureCert,
            azureKey: settings.regionContext.azureKey,
            successCode: 200
         };

      azureGetRequest(getSettings, function (err, resultNodes) {
         if (err) {
            callback(err);
            return;
         }


         if (resultNodes.Deployment.RoleInstanceList[0] && resultNodes.Deployment.RoleInstanceList[0].RoleInstance) {
            nodeCheck = underscore(resultNodes.Deployment.RoleInstanceList[0].RoleInstance, function (node) {
               return node.RoleName[0] === nodeId;
            });

            if (!nodeCheck) {
               setTimeout(getNodePIp, interval, settings, cloudService, deployment, nodeId, pollingCount - 1, interval, callback);

            }
            else {
               PIp = nodeCheck._wrapped[0].InstanceEndpoints[0].InstanceEndpoint[0].Vip[0];
               callback(null, PIp);
               return;
            }
         }
         else {
            setTimeout(getNodePIp, interval, settings, cloudService, deployment, nodeId, pollingCount - 1, interval, callback);
         }
      });

   }


   function getImageOsType(settings, imageName, callback) {
      var imageInfo,
         getSettings = {

            url: 'https://' + settings.regionContext.apiPrefix + '/' +
                 settings.regionContext.subscriptionId + '/services/vmimages?location=' +
                 settings.regionContext.cloudRegion,
            xMsVersion: xMsVersion,
            azureCert: settings.regionContext.azureCert,
            azureKey: settings.regionContext.azureKey,
            successCode: 200
         };

      azureGetRequest(getSettings, function (err, resultImages) {
         var img;

         if (err) {
            callback(err);
            return;
         }
         img = underscore.filter(resultImages.VMImages.VMImage, function (image) {
            return image.Name[0] === imageName;
         });

         imageInfo = underscore.filter(resultImages.VMImages.VMImage, function (image) {
            return image.Name[0] === imageName;
         })[0].OSDiskConfiguration[0].OS[0];
         callback(null, imageInfo);
         return;
      });
   }

   function getNodeInfo(settings, nodeId, callback) {
      var azureStorage;
      azureStorage = getAzureStorage(settings.regionContext);
      azureStorage.getNodeTagging(settings.regionContext.cloudRegion, nodeId, function (err, tagRetval) {

         if (err || !tagRetval) {

            getCloudServicesByLocation(settings, function (err, res) {
               var numberOfCloudService,
                  cloudServicIndex = 0,
                  errors = [];
               if (err || underscore.isEmpty(res)) {
                  callback([err], {});
                  return;
               }

               numberOfCloudService = res.length;
               underscore.forEach(res, function (resCloudService) {


                  var getSettings = {
                     url: 'https://' + settings.regionContext.apiPrefix + '/' + 
                          settings.regionContext.subscriptionId + '/services/hostedservices/' +
                          resCloudService + '/deploymentslots/Production',
                     xMsVersion: xMsVersion,
                     azureCert: settings.regionContext.azureCert,
                     azureKey: settings.regionContext.azureKey,
                     successCode: 200
                  };

                  azureGetRequest(getSettings, function (err, resultNodes) {

                     if (resultNodes) {

                        if (underscore.contains(underscore.flatten(underscore.flatten(underscore.pluck(resultNodes.Deployment.RoleInstanceList[0].RoleInstance, 'RoleName'))), nodeId) === true) {
                           callback([null], {cloudService: resCloudService, deployment: resultNodes.Deployment.Name[0], tagCheck: false});
                           return;
                        }
                     }

                     cloudServicIndex += 1;

                     if (cloudServicIndex === numberOfCloudService) {

                        if (errors.length > 0) {
                           callback(errors, {});
                           return;
                        }
                        callback([new AzureError('node doesn\'t exist')]);
                     }
                  });

               });
            });
         }
         else {
            callback([null], {cloudService: tagRetval.cloudService, deployment: tagRetval.deployment, tagCheck: true});
            return;
         }
      });
   }

   var that = {
      setProxy: function (proxyUrl) {
         tunnelingProxyURL = proxyUrl;
      },

      createRegionContext: function (regionAuthSettings, regionLimits) {
         var apiPrefix;

         apiPrefix = 'management.core.windows.net';
         regionAuthSettings = regionAuthSettings || {};
         if (regionAuthSettings.cloudRegion === 'China East' ||
            regionAuthSettings.cloudRegion === 'China North') {
            apiPrefix = 'management.core.chinacloudapi.cn';
        }

        return {
            cloudRegion: regionAuthSettings.cloudRegion,
            azureCert: regionAuthSettings.azureCert,
            azureKey: regionAuthSettings.azureKey,
            subscriptionId: regionAuthSettings.subscriptionId,
            limits: regionLimits,
            azureSshPem: regionAuthSettings.azureSshPem,
            azureFingerPrint: regionAuthSettings.azureFingerPrint,
            azureWindowsRdpPass: regionAuthSettings.azureWindowsRdpPass,
            providerName: 'azure',
            apiPrefix: apiPrefix,
            storageAccount: regionAuthSettings.storageAccount,
            storageAccessKey: regionAuthSettings.storageAccessKey
         };
      },

      createPreparation: function (settings, callback) {
         var azureStorage;

         azureStorage = getAzureStorage(settings.regionContext);
         azureStorage.createTable('nodesTagging', function (err, res) {
            if (err) {
               callback(err);
               return;
            }


            azureStorage.createTable('imageTagging', function (err, res) {
               if (err) {
                  callback(err);
                  return;
               }

               azureStorage.createTable('nodesIps', function (err, res) {
                  if (err) {
                     callback(err);
                     return;
                  }


                  var cloudServices = [];


                  createCLoudServices(settings, function (err, result) {

                     if (err) {
                        callback(err);
                        return;

                     }
                     var numberOfServices = Math.ceil((settings.nodes.length / settings.regionContext.limits.maxRolesPerService)),
                        servicesIndex = 0,
                        errors = [];

                     underscore.forEach(result, function (cloudService) {

                        var newCloudService;

                        createCLoudDeployment(settings, cloudService, result.indexOf(cloudService), function (err, result) {


                           if (err) {

                              errors.push(err);

                           }

                           newCloudService = {id: cloudService.id, minIndex: cloudService.minIndex, maxIndex: cloudService.maxIndex, deployment: result.deployment, deploymentNode: result.deploymentNode };
                           cloudServices.push(newCloudService);
                           servicesIndex += 1;


                           if (servicesIndex === (numberOfServices)) {

                              if (errors.length > 0) {
                                 callback(errors, cloudServices);
                                 return;
                              }
                              else {
                                 console.log('final cloudServices+deployments-' + JSON.stringify(cloudServices));
                                 callback(null, cloudServices);
                              }
                           }
                        });
                     });
                  });
               });
            });
         });
      },


      listNodes: function (settings, callback) {

         var finalResults = {rawResult: {}, nodes: []}, azureStorage;

         azureStorage = getAzureStorage(settings.regionContext);
         getCloudServicesByLocation(settings, function (err, res) {
            var numberOfCloudService,
               cloudServicIndex = 0,
               errors = [];
            if (err || underscore.isEmpty(res)) {
               callback(err, {});
               return;
            }

            numberOfCloudService = res.length;
            underscore.forEach(res, function (cloudService) {

               getDeploymentNodeList(settings, cloudService, function (err, deploymentRes) {
                  if (err && (err[0])) {
                     errors.push(err);
                  }

                  finalResults.rawResult = underscore.extend(finalResults.rawResult, deploymentRes.rawResult);
                  finalResults.nodes = underscore.union(finalResults.nodes, deploymentRes.nodes);
                  cloudServicIndex += 1;

                  if (cloudServicIndex === numberOfCloudService) {

                     if (errors.length > 0) {
                        callback(errors, {});
                        return;
                     }

                     azureStorage.getNodes(settings.regionContext.cloudRegion, function (error, resultNodes) {

                        if (error) {
                           callback(err, {});
                           return;
                        }

                        margeNodesLists(settings, resultNodes, finalResults, function (err, res) {
                           if (err) {
                              callback(err, {});
                              return;
                           }

                           callback(null, res);

                        });
                     });
                  }
               });
            });
         });
      },

      createNode: function (settings, cloudServicesTestSettings, nodeIndex, callback) {

         var resultNode,
            userData,
            launchStatus,
            cloudService = underscore.filter(cloudServicesTestSettings, function (service) {
               return (nodeIndex >= service.minIndex && nodeIndex <= service.maxIndex);
            }),
            nodeName = 'nodeCreatedByStorm' + (new Date().valueOf()),
            xmlBody, azureStorage;

         azureStorage = getAzureStorage(settings.regionContext);
         if (settings.nodeParams.userData) {
            userData = new Buffer(JSON.stringify(settings.nodeParams.userData)).toString('base64');
         }

         else {
            userData = 'IHt9';
         }

         getImageOsType(settings, settings.nodeParams.imageId, function (err, res) {
            if (err) {
               resultNode = {rawResult: 'node was not created'};
               callback(err, resultNode);
               return;
            }

            if (res === 'Linux') {

               xmlBody = '<PersistentVMRole xmlns="http://schemas.microsoft.com/windowsazure" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">' +
                  '<RoleName>' + nodeName + '</RoleName>' +
                  '<RoleType>PersistentVMRole</RoleType>' +
                  '<ConfigurationSets><ConfigurationSet i:type="LinuxProvisioningConfigurationSet">' +
                  '<ConfigurationSetType>LinuxProvisioningConfiguration</ConfigurationSetType>' +
                  '<HostName>' + nodeName + '</HostName>' +
                  '<UserName>ubuntu</UserName>' +
                  '<UserPassword></UserPassword>' +
                  '<DisableSshPasswordAuthentication>true</DisableSshPasswordAuthentication>' +
                  '<SSH>' +
                  '<PublicKeys>' +
                  '<PublicKey>' +
                  '<Fingerprint>' + settings.regionContext.azureFingerPrint + '</Fingerprint>' +
                  '<Path>/home/azureuser/.ssh/authorized_keys</Path>' +
                  '</PublicKey>' +
                  '</PublicKeys>' +
                  '<KeyPairs>' +
                  '<KeyPair>' +
                  '<Fingerprint>' + settings.regionContext.azureFingerPrint + '</Fingerprint>' +
                  '<Path>/home/azureuser/.ssh/id_rsa</Path>' +
                  '</KeyPair>' +
                  '</KeyPairs>' +
                  '</SSH>' +
                  '<CustomData>' + userData + '</CustomData>' +
                  '</ConfigurationSet>' +
                  '<ConfigurationSet>' +
                  '<ConfigurationSetType>NetworkConfiguration</ConfigurationSetType>' +
                  '</ConfigurationSet>' +
                  '</ConfigurationSets>' +
                  '<VMImageName>' + settings.nodeParams.imageId + '</VMImageName>' +
                  '<RoleSize>' + settings.nodeParams.instanceType + '</RoleSize>' +
                  '</PersistentVMRole>';
            }

            else if (res === 'Windows') {

               xmlBody =
                  '<PersistentVMRole xmlns="http://schemas.microsoft.com/windowsazure" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">' +
                     '<RoleName>' + nodeName + '</RoleName>' +
                     '<RoleType>PersistentVMRole</RoleType>' +
                     '<ConfigurationSets>' +
                     '<ConfigurationSet>' +
                     '<ConfigurationSetType>WindowsProvisioningConfiguration</ConfigurationSetType>' +
                     '<ComputerName>storm</ComputerName>' +
                     '<AdminPassword>'+settings.regionContext.azureWindowsRdpPass+'</AdminPassword>' +
                     '<EnableAutomaticUpdates>false</EnableAutomaticUpdates>' +
                     '<AdminUsername>storm</AdminUsername>' +
                     '<CustomData>' + userData + '</CustomData>' +
                     '</ConfigurationSet>' +
                     '<ConfigurationSet>' +
                     '<ConfigurationSetType>NetworkConfiguration</ConfigurationSetType>' +
                     '</ConfigurationSet>' +
                     '</ConfigurationSets>' +
                     '<VMImageName>' + settings.nodeParams.imageId + '</VMImageName>' +
                     '<RoleSize>' + settings.nodeParams.instanceType + '</RoleSize>' +
                     '<ProvisionGuestAgent>true</ProvisionGuestAgent>' +
                     '</PersistentVMRole>';


            }


            if (!cloudService[0]) {
               callback(new AzureError('no cloud service was allocated for node creation'), {});
               return;
            }

            // in case the node is the first in the cloud service the node was already created

            if (cloudService[0].minIndex === nodeIndex) {

               getNodePIp(settings, cloudService[0].id, cloudService[0].deployment, cloudService[0].deploymentNode.nodeName, 40, interval, function (err, resultIp) {
                  var azureStorage;
                  azureStorage = getAzureStorage(settings.regionContext);
                  if (err) {
                     resultNode = {rawResult: 'node-' + cloudService[0].deploymentNode.nodeName + ' was created.', node: {id: cloudService[0].deploymentNode.nodeName, status: 'ERROR', addresses: null, tags: cloudService[0].deploymentNode.tags}};
                     callback('err get node IP-' + err, resultNode);
                     return;

                  }

                  azureStorage.addNodeIp('nodeIp', cloudService[0].deploymentNode.nodeName, resultIp, function (err, resultIp) {
                     if (err) {
                        resultNode = {rawResult: 'node-' + cloudService[0].deploymentNode.nodeName + ' was created.', node: {id: cloudService[0].deploymentNode.nodeName, status: 'ERROR', addresses: null, tags: cloudService[0].deploymentNode.tags}};
                        callback('err get node IP-' + err, resultNode);
                        return;
                     }

                     resultNode = {rawResult: 'node-' + cloudService[0].deploymentNode.nodeName + ' was created.', node: {id: cloudService[0].deploymentNode.nodeName, status: ((cloudService[0].deploymentNode.launchStatus === 'OK') ? 'Starting' : 'ERROR_' + cloudService[0].deploymentNode.launchStatus), addresses: null, tags: cloudService[0].deploymentNode.tags}};

                     callback(null, resultNode);

                     return;

                  });
               });
            }
            else {


               var postSettings = {
                  url: 'https://' + settings.regionContext.apiPrefix + '/' +
                       settings.regionContext.subscriptionId + '/services/hostedservices/' +
                       cloudService[0].id + '/deployments/' +
                       cloudService[0].deployment + '/roles',
                  xMsVersion: xMsVersion,
                  azureCert: settings.regionContext.azureCert,
                  azureKey: settings.regionContext.azureKey,
                  successCode: [202],
                  xmlBody: xmlBody,
                  retryCodes: [307, 409],
                  restType: 'post'

               };

               azureRetryRequest(postSettings, 40, interval, function (err, result) {
                  if (err) {
                     callback(err);
                     return;
                  }

                  else {
                     launchStatus = 'OK';
                  }

                  var cloudServiceSetting = {cloudService: cloudService[0].id, deployment: cloudService[0].deployment};


                  azureStorage.addNodeTagging(settings.regionContext.cloudRegion, nodeName, settings.nodeParams.tags, launchStatus, cloudServiceSetting, function (err, tagRetval) {

                     if (err) {
                        callback('err add node tagging-' + err);
                        return;

                     }

                     getNodePIp(settings, cloudService[0].id, cloudService[0].deployment, nodeName, 40, interval, function (err, resultIp) {
                        if (err) {
                           callback('err get node IP-' + err);
                           return;

                        }


                        azureStorage.addNodeIp('nodeIp', nodeName, resultIp, function (err, resultIp) {
                           if (err) {
                              callback('err add node IP-' + err);
                              return;

                           }
                           var resultNode = {rawResult: 'node-' + nodeName + ' was created.', node: {id: nodeName, status: ((launchStatus === 'OK') ? 'Starting' : 'ERROR_' + launchStatus), addresses: null, tags: settings.nodeParams.tags}};


                           callback(null, resultNode);

                        });
                     });
                  });
               });
            }
         });
      },


      deleteNode: function (settings, callback) {
         var cloudService,
            deployment,
            tagCheck, azureStorage;

         azureStorage = getAzureStorage(settings.regionContext);
         if (!settings.node || !settings.node.id) {
            callback(new AzureError('missing node id input'),{rawResult: 'failed to delete node'});
            return;
         }

         getNodeInfo(settings, settings.node.id, function (err, infoResult) {

            if (err[0]) {
               callback(err, {rawResult: 'failed to delete node-' + settings.node.id});
               return;
            }

            cloudService = infoResult.cloudService;
            deployment = infoResult.deployment;
            tagCheck = infoResult.tagCheck;

            // execute delete node rest
            var DelSettings = {
               url: 'https://' + settings.regionContext.apiPrefix + '/' +
                    settings.regionContext.subscriptionId + '/services/hostedservices/' +
                    cloudService + '/deployments/' + deployment + '/roles/' +
                    settings.node.id + '?comp=media',
               xMsVersion: xMsVersion,
               azureCert: settings.regionContext.azureCert,
               azureKey: settings.regionContext.azureKey,
               successCode: [202, 400],
               retryCodes: [307, 409]
            };

            azureRetryDeleteRequest(DelSettings, 40, interval, function (err, delResRole) {
               if (err) {
                  callback(err, {rawResult: 'failed to delete node-' + settings.node.id});
                  return;

               }


               // response 400 means last role in the deployment
               if (delResRole === 400) {

                  var DelSettings = {
                     url: 'https://' + settings.regionContext.apiPrefix + '/' +
                          settings.regionContext.subscriptionId + '/services/hostedservices/' +
                          cloudService + '/deployments/' + deployment+'?comp=media',
                     xMsVersion: xMsVersion,
                     azureCert: settings.regionContext.azureCert,
                     azureKey: settings.regionContext.azureKey,
                     successCode: [202],
                     retryCodes: [307, 409]
                  };

                  // in case of last role in deployment delete cloud service
                  azureRetryDeleteRequest(DelSettings, 40, interval, function (err, delResDeploy) {
                     if (err) {
                        callback(err, {rawResult: 'failed to delete node-' + settings.node.id});
                        return;

                     }

                     var DelSettings = {
                        url: 'https://' + settings.regionContext.apiPrefix + '/' +
                             settings.regionContext.subscriptionId + '/services/hostedservices/' +
                             cloudService+'?comp=media',
                        xMsVersion: xMsVersion,
                        azureCert: settings.regionContext.azureCert,
                        azureKey: settings.regionContext.azureKey,
                        successCode: [202],
                        retryCodes: [307, 409]
                     };

                     // in case of last role delete deployment +cloud service
                     azureRetryDeleteRequest(DelSettings, 40, interval, function (err, delResService) {
                        if (err) {
                           callback(err, {rawResult: 'failed to delete node-' + settings.node.id});
                           return;

                        }

                        if (tagCheck === false) {
                           callback(null, {rawResult: 'node-' + settings.node.id + ' was deleted'});
                           return;
                        }

                        azureStorage.deleteTagging('node', settings.regionContext.cloudRegion, settings.node.id, function (err, deleteTagRetval) {

                           if (err) {
                              callback(err, {rawResult: 'failed to delete node-' + settings.node.id});
                              return;

                           }

                           azureStorage.deleteTagging('pIp', settings.regionContext.cloudRegion, settings.node.id, function (err, deleteTagRetval) {

                              if (err) {
                                 callback(err, {rawResult: 'failed to delete IP to node-' + settings.node.id});
                                 return;

                              }
                              callback(null, {rawResult: 'node-' + settings.node.id + ' was deleted'});
                           });
                        });
                     });
                  });
               }

               else {

                  if (tagCheck === false) {
                     callback(null, delResRole);
                     return;
                  }

                  azureStorage.deleteTagging('node', settings.regionContext.cloudRegion, settings.node.id, function (err, deleteTagRetval) {

                     if (err) {
                        callback(err, {rawResult: 'failed to delete node-' + settings.node.id + ' tagging'});
                        return;

                     }
                     azureStorage.deleteTagging('pIp', settings.regionContext.cloudRegion, settings.node.id, function (err, deleteTagRetval) {

                        if (err) {
                           callback(err, {rawResult: 'failed to delete IP to node-' + settings.node.id});
                           return;

                        }

                        callback(null, {rawResult: 'node-' + settings.node.id + ' was deleted'});
                     });

                  });
               }

               // delete node tagging


            });
         });

      },

      createImage: function (settings, callback) {
         var azureStorage, imageName = 'imageCreatedByStorm' + (new Date().valueOf());

         azureStorage = getAzureStorage(settings.regionContext);
         azureStorage.getNodeTagging(settings.regionContext.cloudRegion, settings.imageParams.nodeId, function (err, tagRetval) {
            if (err) {
               callback(err);
               return;

            }


            // stop VM before creating image
            stopNode(settings, tagRetval.cloudService, tagRetval.deployment, settings.imageParams.nodeId, 40, interval, function (err, resStop) {

               if (err) {
                  callback(err);
                  return;
               }

               var xmlBody = '<CaptureRoleAsVMImageOperation xmlns="http://schemas.microsoft.com/windowsazure" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">' +
                     '<OperationType>CaptureRoleAsVMImageOperation</OperationType>' +
                     '<OSState>Generalized</OSState>' +
                     '<VMImageName>' + imageName + '</VMImageName>' +
                     '<VMImageLabel>' + imageName + '</VMImageLabel>' +
                     '</CaptureRoleAsVMImageOperation>',
                  postSettings = {
                     url: 'https://' + settings.regionContext.apiPrefix + '/' +
                          settings.regionContext.subscriptionId + '/services/hostedservices/' +
                          tagRetval.cloudService + '/deployments/' +
                          tagRetval.deployment + '/roleinstances/' +
                          settings.imageParams.nodeId + '/Operations',
                     xMsVersion: xMsVersion,
                     azureCert: settings.regionContext.azureCert,
                     azureKey: settings.regionContext.azureKey,
                     successCode: [202],
                     xmlBody: xmlBody,
                     retryCodes: [307, 409, 400],
                     restType: 'post'

                  };

               azureRetryRequest(postSettings, 40, interval, function (err, result) {
                  if (err) {
                     callback(err);
                     return;
                  }

                  azureStorage.addImageTagging(settings.regionContext.cloudRegion, imageName, settings.imageParams.tags, function (err, res) {
                     if (err) {
                        callback(err);
                        return;
                     }

                     // checks if this is the last VM of the deployment/service  and delete it if this is the case

                     deleteService(settings, tagRetval.cloudService, tagRetval.deployment, function (err, res) {
                        if (err) {
                           callback(err);
                           return;
                        }

                        // delete the tagging for the deleted node
                        azureStorage.deleteTagging('node', settings.regionContext.cloudRegion, settings.imageParams.nodeId, function (err, res) {

                           callback(null, {rawResult: null, imageId: imageName});
                        });

                     });
                  });
               });

            });

         });

      },


      listImages: function (settings,imageIdsArr, callback) {


         var azureStorage, finalResults = {rawResult: {}, images: []},
            getSettings = {
               url: 'https://' + settings.regionContext.apiPrefix + '/' +
                    settings.regionContext.subscriptionId + '/services/vmimages',
               xMsVersion: xMsVersion,
               azureCert: settings.regionContext.azureCert,
               azureKey: settings.regionContext.azureKey,
               successCode: 200
            };

         azureStorage = getAzureStorage(settings.regionContext);
         azureGetRequest(getSettings, function (err, result) {
            if (err) {
               callback(err);
               return;
            }

            var filterImages = underscore.filter(result.VMImages.VMImage, function (imagefilter) {
                  return (imagefilter.Category[0] === 'User' && imagefilter.Location[0] === settings.regionContext.cloudRegion);
               }),
               numberOfImages = filterImages.length,
               imageIndex = 0,
               errors = [];

            finalResults.rawResult = filterImages;

            underscore.forEach(filterImages, function (imageEach) {
               azureStorage.getImageTagging(settings.regionContext.cloudRegion, imageEach.Name[0], function (err, tagRetval) {

                  if (err) {
                     errors.push(err);
                  }

                  imageIndex += 1;

                  var image = {
                     id: imageEach.Name[0],
                     status: 'ACTIVE',
                     name: imageEach.Name[0],
                     creationTime: imageEach.CreatedTime[0],
                     tags: tagRetval
                  };

                  finalResults.images.push(image);

                  if (imageIndex === numberOfImages) {

                     azureStorage.getImages(settings.regionContext.cloudRegion, function (error, resultImages) {

                        if (error) {
                           callback(err);
                           return;
                        }

                        margeImagesLists(settings, resultImages, finalResults, function (err, res) {
                           if (err) {
                              callback(err);
                              return;
                           }

                           if (errors.lengt > 0) {
                              callback(errors, res);
                           }
                           else {
                              callback(null, res);
                           }
                        });
                     });
                  }
               });

            });
         });
      },

      deleteImage: function (settings, callback) {

         var azureStorage, DelSettings = {
            url: 'https://' + settings.regionContext.apiPrefix + '/' +
                 settings.regionContext.subscriptionId + '/services/vmimages/' +
                 settings.imageParams.imageId + '?comp=media',
            xMsVersion: xMsVersion,
            azureCert: settings.regionContext.azureCert,
            azureKey: settings.regionContext.azureKey,
            successCode: [202],
            retryCodes: [307, 409]
         };

         azureStorage = getAzureStorage(settings.regionContext);
         azureRetryDeleteRequest(DelSettings, 40, interval, function (err, delRes) {
            if (err) {
               callback(err);
               return;

            }
            azureStorage.deleteTagging('image', settings.regionContext.cloudRegion, settings.imageParams.imageId, function (err, res) {
               callback(err, delRes);
               return;
            });

         });

      },

      associateAddress: function (settings, callback) {
         var error = new AzureError('no implementation');
         callback(error, null);
      },

      disassociateAddress: function (settings, callback) {
         var error = new AzureError('no implementation');
         callback(error, null);
      },

      deleteDiscs: function (settings, callback) {

         var errors=[], numOfDIscs, discIndex=0, getSettings = {
            url: 'https://management.core.windows.net/' + settings.regionContext.subscriptionId + '/services/disks',
            xMsVersion: xMsVersion,
            azureCert: settings.regionContext.azureCert,
            azureKey: settings.regionContext.azureKey,
            successCode: 200
         };

         azureGetRequest(getSettings, function (errGet, resultGet) {
            if (errGet || !resultGet.Disks.Disk) {
               callback(errGet);
               return;
            }
            else {
               numOfDIscs = resultGet.Disks.Disk.length;
               underscore.forEach(resultGet.Disks.Disk, function (disk) {

                  console.log('disk- '+disk.MediaLink[0] + '- will be deleted');

                  var DelSettings = {
                     url: 'https://management.core.windows.net/' + settings.regionContext.subscriptionId + '/services/disks/' + disk.Name[0],
                     xMsVersion: xMsVersion,
                     azureCert: settings.regionContext.azureCert,
                     azureKey: settings.regionContext.azureKey,
                     successCode: [200,400],
                     retryCodes: [307, 409, 503]
                  }

                  azureRetryDeleteRequest(DelSettings, 10, interval, function (err, delResService) {

                     if (err) {
                        errors.push(err);
                     }

                     console.log('delResService-' + JSON.stringify(delResService));
                     console.log('err-' + JSON.stringify(err));
                     discIndex += 1;

                     console.log('i am here !!!'+discIndex+'  '+numOfDIscs)

                     if (discIndex === numOfDIscs) {

                        callback(errors)

                     }

                  })

               });
            }
         });

      },

      deleteObjects: function (settings, callback) {

         var servicesIndex = 0,
            numOfCloudServices,
            DelSettings,
            cloudServices,
            errors = [],
            getSettings = {
               url: 'https://' + settings.regionContext.apiPrefix + '/' +
                    settings.regionContext.subscriptionId + '/services/hostedservices',
               xMsVersion: xMsVersion,
               azureCert: settings.regionContext.azureCert,
               azureKey: settings.regionContext.azureKey,
               successCode: 200
            };

         azureGetRequest(getSettings, function (err, result) {
            if (err) {
               callback([err]);
               return;
            }

            cloudServices = underscore.filter(result.HostedServices.HostedService, function (service) {
               // filter just services from the  region and which were created before more the 30 minutes
               return (service.HostedServiceProperties[0].Location[0] === settings.regionContext.cloudRegion) && ((new Date()).getTime() > Date.parse(service.HostedServiceProperties[0].DateCreated[0]) + (1000 * 60 * 60 * 1));
            });


            numOfCloudServices = cloudServices.length;

            if (numOfCloudServices === 0) {
               callback([]);
               return;
            }

            underscore.forEach(cloudServices, function (cloudService) {

               var cloudServiceName = cloudService.HostedServiceProperties[0].ExtendedProperties[0].ExtendedProperty[0].Value[0],
                  errFlag=false;

               getDeploymentNodeList(settings, cloudServiceName, function (err, deploymentRes) {
                  if (err && (err[0])) {
                     errors.push(err);
                     errFlag=true;
                  }

                  // in case there is no deployment
                  if (errFlag===false && !deploymentRes.nodes[0]) {
                     DelSettings = {
                        url: 'https://' + settings.regionContext.apiPrefix + '/' +
                             settings.regionContext.subscriptionId + '/services/hostedservices/' +
                             cloudServiceName + '?comp=media',
                        xMsVersion: xMsVersion,
                        azureCert: settings.regionContext.azureCert,
                        azureKey: settings.regionContext.azureKey,
                        successCode: [200],
                        retryCodes: [307, 409]
                     };
                     console.log('service-' + cloudServiceName + ' on :' + settings.regionContext.cloudRegion + ' will be deleted by watchdog');
                     // delete service
                     azureRetryDeleteRequest(DelSettings, 40, interval, function (err, delResService) {


                        if (err) {
                           errors.push(err);
                        }

                        servicesIndex += 1;
                        if (servicesIndex === numOfCloudServices) {
                           callback(errors);
                        }
                     });
                  }
                  else {
                     servicesIndex += 1;
                     if (servicesIndex === numOfCloudServices) {
                        callback(errors);
                     }
                  }

               });
            });

         });


      }
   };
   return that;
})();

