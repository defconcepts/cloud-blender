/**
 * Created with IntelliJ IDEA.
 * User: omer
 * Date: 12/21/14
 * Time: 8:44 AM
 * To change this template use File | Settings | File Templates.
 */
var request = require('request'),
   underscore = require('underscore'),
   fs = require('fs'),
   xml2js = require('xml2js'),
   azureStorage = require('./azure_storage'),
   parseString = xml2js.parseString,
   interval = 2000,
   xMsVersion = '2014-06-01',
   tunnelingProxyURL;


module.exports = (function () {

   function azureRetryDeleteRequest(settings, pollingCount, interval, callback) {


      var deleteRequestSettings = {
         method: 'DELETE',
         headers: {
            'x-ms-version': settings.xMsVersion
         },

         url: settings.url,
         cert: fs.readFileSync(settings.azureCertPath),
         key: fs.readFileSync(settings.azureKeyPath)
      };

      request(deleteRequestSettings, function (err, res, body) {



         // in case of retry code and there we didn't reached to max polling


         if (pollingCount > 0 && underscore.contains(settings.retryCodes, res.statusCode) === true) {
            setTimeout(azureRetryDeleteRequest, interval, settings, pollingCount - 1, interval, callback);
         }

         // in case owe got an error code which is not success/retry

         if ((err || underscore.contains(settings.successCode, res.statusCode) === false) && underscore.contains(settings.retryCodes, res.statusCode) === false) {
            callback(err || new Error('res.statusCode-' + res.statusCode + ' ' + res.body));
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

         cert: fs.readFileSync(settings.azureCertPath),
         key: fs.readFileSync(settings.azureKeyPath),
         body: settings.xmlBody

      }, function (err, res, body) {

         // in case of retry code and there we didn't reached to max polling

         if (pollingCount > 0 && underscore.contains(settings.retryCodes, res.statusCode) === true) {
            setTimeout(azureRetryRequest, interval, settings, pollingCount - 1, interval, callback);
         }


         // in case owe got an error code which is not success/retry

         if ((err || underscore.contains(settings.successCode, res.statusCode) === false) && underscore.contains(settings.retryCodes, res.statusCode) === false) {
            callback(err || new Error('res.statusCode-' + res.statusCode + ' ' + res.body));
            return;
         }
         if (underscore.contains(settings.successCode, res.statusCode) === true) {
            callback(null, res);
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
         cert: fs.readFileSync(settings.azureCertPath),
         key: fs.readFileSync(settings.azureKeyPath)
      };


      request(getSettings, function (err, response, body) {


         if (err || response.statusCode !== settings.successCode) {

            callback(err || new Error('res.statusCode-' + response.statusCode + ' ' + response.body));
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


   function checkPollCloudServices(subscriptionId, azureCertPath, azureKeyPath, newServicesArr, pollingCount, interval, callback) {

      var getSettings = {
         url: 'https://management.core.windows.net/' + subscriptionId + '/services/hostedservices',
         xMsVersion: xMsVersion,
         azureCertPath: azureCertPath,
         azureKeyPath: azureKeyPath,
         successCode: 200
      };

      azureGetRequest(getSettings, function (err, result) {

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
               callback(new Error('max polling for cloud services'));
               return;
            }

            else {
               setTimeout(checkPollCloudServices, interval, subscriptionId, azureCertPath, azureKeyPath, newServicesArr, pollingCount - 1, interval, callback);
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
            url: 'https://management.core.windows.net/' + settings.regionContext.subscriptionId + '/services/hostedservices',
            xMsVersion: xMsVersion,
            azureCertPath: settings.regionContext.azureCertPath,
            azureKeyPath: settings.regionContext.azureKeyPath,
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

               checkPollCloudServices(settings.regionContext.subscriptionId, settings.regionContext.azureCertPath, settings.regionContext.azureKeyPath, underscore.pluck(cloudServices, 'id'), 20, interval, function (err, res) {
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

      var pemFile = fs.readFileSync(settings.regionContext.azureSshPemPath),
         xmlBody = '<CertificateFile xmlns="http://schemas.microsoft.com/windowsazure">' +
            '<Data>' + pemFile + '</Data>' +
            '<CertificateFormat>pfx</CertificateFormat>' +
            '<Password></Password>' +
            '</CertificateFile>',
         postSettings = {
            url: 'https://management.core.windows.net/' + settings.regionContext.subscriptionId + '/services/hostedservices/' + cloudService + '/certificates',
            xMsVersion: xMsVersion,
            azureCertPath: settings.regionContext.azureCertPath,
            azureKeyPath: settings.regionContext.azureKeyPath,
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
            userData;


         if (settings.nodes[servicesIndex * settings.regionContext.limits.maxRolesPerService].userData) {

            userData = new Buffer(JSON.stringify(settings.nodes[servicesIndex * settings.regionContext.limits.maxRolesPerService].userData)).toString('base64');
         }

         else {
            userData = 'IHt9';
         }

         var deploymentName = 'deploymentCreatedByStorm' + (new Date().valueOf()),
            nodeName = 'nodeCreatedByStorm' + (new Date().valueOf()),
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
               '<UserName>storm</UserName>' +
               '<UserPassword></UserPassword>' +
               '<DisableSshPasswordAuthentication>false</DisableSshPasswordAuthentication>' +
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
               '<PublicIPs>'+
               '<PublicIP>'+
               '<Name>'+nodeName +'_ip</Name>'+
               '</PublicIP>'+
               '</PublicIPs>'+
               '</ConfigurationSet>' +
               '</ConfigurationSets>' +
               '<VMImageName>' + vmImageName + '</VMImageName>' +
               '<RoleSize>'+instanceType+'</RoleSize>'+
               '</Role>' +
               '</RoleList>' +
               '</Deployment>',
            postSettings = {
               url: 'https://management.core.windows.net/' + settings.regionContext.subscriptionId + '/services/hostedservices/' + cloudService.id + '/deployments',
               xMsVersion: xMsVersion,
               azureCertPath: settings.regionContext.azureCertPath,
               azureKeyPath: settings.regionContext.azureKeyPath,
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


            // in case there wasn't rest error
            var launchStatus = 'OK',
               cloudServiceSetting = {cloudService: cloudService.id, deployment: deploymentName, deploymentNode: {nodeName: nodeName, launchStatus: launchStatus, tags: settings.nodes[servicesIndex * settings.regionContext.limits.maxRolesPerService].tags}};


            azureStorage.addNodeTagging(settings.regionContext.cloudRegion, nodeName, settings.nodes[servicesIndex * settings.regionContext.limits.maxRolesPerService].tags, launchStatus, cloudServiceSetting, function (err, tagRetval) {

               if (err) {

                  callback('err add node tagging-' + err);
                  return;

               }

               callback(null, cloudServiceSetting);

            });

         });
      });
   }


   function getCloudServicesByLocation(settings, callback) {

      var getSettings = {
         url: 'https://management.core.windows.net/' + settings.regionContext.subscriptionId + '/services/hostedservices',
         xMsVersion: xMsVersion,
         azureCertPath: settings.regionContext.azureCertPath,
         azureKeyPath: settings.regionContext.azureKeyPath,
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

   function margeNodesLists(storageNodes, nodesList, callback) {


      var finalResults = nodesList,
         numberOfTagsNodes = storageNodes.length,
         nodeTagsIndex = 0;

      if (numberOfTagsNodes === 0) {
         callback(null, nodesList);
      }

      underscore.forEach(storageNodes, function (nodeResult) {

         // check if the node exists already from rest API if not we will add it from the storage.

         if (underscore.contains(underscore.pluck(nodesList.nodes, 'id'), nodeResult.RowKey) === false) {

            var tag = {};

            underscore.forEach(underscore.filter(underscore.keys(nodeResult), function (key) {
               return key.indexOf('key') > -1;
            }), function (key) {
               tag[nodeResult[key]] = nodeResult['values' + key.substring(4, 5)];

            });


            var node = {
               id: nodeResult.RowKey,
               status: ((nodeResult.launchStatus === 'OK') ? 'Starting' : 'ERROR_' + nodeResult.launchStatus),
               addresses: null,
               tags: tag
            };

            finalResults.nodes.push(node);
         }

         nodeTagsIndex += 1;

         if (nodeTagsIndex === numberOfTagsNodes) {

            callback(null, finalResults);

            return;
         }

      });


   }

   function margeImagesLists(storageImages, imageList, callback) {


      var finalResults = imageList,
         numberOfTagsImages = storageImages.length,
         imageTagsIndex = 0;

      if (numberOfTagsImages === 0) {
         callback(null, imageList);
      }

      underscore.forEach(storageImages, function (imageResult) {

         // check if the node exists already from rest API if not we will add it from the storage.

         if (underscore.contains(underscore.pluck(imageList.nodes, 'id'), imageResult.RowKey) === false) {

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
            url: 'https://management.core.windows.net/' + settings.regionContext.subscriptionId + '/services/hostedservices/' + cloudService + '/deployments/' + deployment + '/roleinstances/' + node + '/Operations',
            xMsVersion: xMsVersion,
            azureCertPath: settings.regionContext.azureCertPath,
            azureKeyPath: settings.regionContext.azureKeyPath,
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
            url: 'https://management.core.windows.net/' + settings.regionContext.subscriptionId + '/services/hostedservices/' + cloudService + '/deployments/' + deployment,
            xMsVersion: xMsVersion,
            azureCertPath: settings.regionContext.azureCertPath,
            azureKeyPath: settings.regionContext.azureKeyPath,
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
                     callback(new Error('max polling for stop Node'));
                     return;
                  }

                  else {

                     setTimeout(stopNode, interval, settings, cloudService, deployment, node, pollingCount, interval - 1, callback);
                  }
               }


            }
         )
         ;


      });

   }


   function getDeploymentNodeList(settings, cloudService, callback) {

      var DeploymentFinalResults = {nodes: []},
         getSettings = {
            url: 'https://management.core.windows.net/' + settings.regionContext.subscriptionId + '/services/hostedservices/' + cloudService + '/deploymentslots/Production',
            xMsVersion: xMsVersion,
            azureCertPath: settings.regionContext.azureCertPath,
            azureKeyPath: settings.regionContext.azureKeyPath,
            successCode: 200
         };

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

                  var tagging,vIp;

                  if (err) {
                     errors.push(err);
                     tagging = {};
                  }


                  if (!tagRetval) {
                     tagging = {};
                  }
                  else {
                     tagging = tagRetval.finalTagging;
                  }


                  if(nodeResult.PublicIPs){
                     vIp=nodeResult.PublicIPs[0].PublicIP[0].Address[0];

                  }

                  var node = {
                     id: nodeResult.RoleName[0],
                     status: ((nodeResult.PowerState[0] === 'Started') ? 'ACTIVE' : nodeResult.PowerState[0]),
                     addresses: [nodeResult.IpAddress[0],vIp],
                     tags: tagging
                  };

                  DeploymentFinalResults.nodes.push(node);

                  nodeIndex += 1;


                  if (nodeIndex === numberOfNodes) {
                     callback(underscore.without(errors,''), DeploymentFinalResults);
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

   var that = {
      setProxy: function (proxyUrl) {
         tunnelingProxyURL = proxyUrl;
      },

      createRegionContext: function (regionAuthSettings, regionLimits) {

         return {
            cloudRegion: regionAuthSettings.cloudRegion,
            azureCertPath: regionAuthSettings.azureCertPath,
            azureKeyPath: regionAuthSettings.azureKeyPath,
            subscriptionId: regionAuthSettings.subscriptionId,
            limits: regionLimits,
            azureSshPemPath: regionAuthSettings.azureSshPemPath,
            azureFingerPrint: regionAuthSettings.azureFingerPrint,
            providerName: 'azure'
         };
      },


      createPreparation: function (settings, callback) {


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

                     createCLoudDeployment(settings, cloudService, servicesIndex, function (err, result) {


                        if (err) {

                           errors.push(err);

                        }


                        servicesIndex += 1;

                        var newCloudService = {id: cloudService.id, minIndex: cloudService.minIndex, maxIndex: cloudService.maxIndex, deployment: result.deployment, deploymentNode: result.deploymentNode };


                        cloudServices.push(newCloudService);


                        if (servicesIndex === numberOfServices) {
                       ;
                           if (errors.length > 0) {
                              callback(errors);
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
      },


      listNodes: function (settings, callback) {



         var finalResults = {rawResult: {}, nodes: []};

         getCloudServicesByLocation(settings, function (err, res) {
            var numberOfCloudService,
               cloudServicIndex = 0,
               errors = [];

            if (err) {
               callback(err);
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
                        callback(errors);
                       return;
                     }

                     azureStorage.getNodes(settings.regionContext.cloudRegion, function (error, resultNodes) {

                        if (error) {
                           callback(err);
                           return;
                        }

                        margeNodesLists(resultNodes, finalResults, function (err, res) {
                           if (err) {
                              callback(err);
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

         var userData,
            launchStatus,
            cloudService = underscore.filter(cloudServicesTestSettings, function (service) {
               return (nodeIndex >= service.minIndex && nodeIndex <= service.maxIndex);
            }),
            nodeName = 'nodeCreatedByStorm' + (new Date().valueOf()),
            xmlBody;


         if (settings.nodeParams.userData) {
            userData = new Buffer(JSON.stringify(settings.nodeParams.userData)).toString('base64');
         }

         else {
            userData = 'IHt9';
         }


         xmlBody = '<PersistentVMRole xmlns="http://schemas.microsoft.com/windowsazure" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">' +
            '<RoleName>' + nodeName + '</RoleName>' +
            '<RoleType>PersistentVMRole</RoleType>' +
            '<ConfigurationSets><ConfigurationSet i:type="LinuxProvisioningConfigurationSet">' +
            '<ConfigurationSetType>LinuxProvisioningConfiguration</ConfigurationSetType>' +
            '<HostName>' + nodeName + '</HostName>' +
            '<UserName>storm</UserName>' +
            '<UserPassword></UserPassword>' +
            '<DisableSshPasswordAuthentication>false</DisableSshPasswordAuthentication>' +
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
            '<PublicIPs>'+
            '<PublicIP>'+
            '<Name>'+nodeName+'_ip</Name>'+
            '</PublicIP>'+
            '</PublicIPs>'+
            '</ConfigurationSet>' +
            '</ConfigurationSets>' +
            '<VMImageName>' + settings.nodeParams.imageId + '</VMImageName>' +
            '<RoleSize>'+settings.nodeParams.instanceType+'</RoleSize>'+
            '</PersistentVMRole>';


         if (!cloudService[0]) {
            callback(new Error('no cloud service was allocated for node creation'));
            return;
         }

         // in case the node is the first in the cloud service the node was already created

         if (cloudService[0].minIndex === nodeIndex) {


            var resultNode = {rawResult: {}, node: {id: cloudServicesTestSettings[0].deploymentNode.nodeName, status: ((cloudServicesTestSettings[0].deploymentNode.launchStatus === 'OK') ? 'Starting' : 'ERROR_' + cloudServicesTestSettings[0].deploymentNode.launchStatus), addresses: null, tags: cloudServicesTestSettings[0].deploymentNode.tags}};

            callback(null, resultNode);


         }

         else {


            var postSettings = {
               url: 'https://management.core.windows.net/' + settings.regionContext.subscriptionId + '/services/hostedservices/' + cloudService[0].id + '/deployments/' + cloudService[0].deployment + '/roles',
               xMsVersion: xMsVersion,
               azureCertPath: settings.regionContext.azureCertPath,
               azureKeyPath: settings.regionContext.azureKeyPath,
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

                  var resultNode = {rawResult: result, node: {id: nodeName, status: ((launchStatus === 'OK') ? 'Starting' : 'ERROR_' + launchStatus), addresses: null, tags: settings.nodeParams.tags}};


                  callback(null, resultNode);


               });
            });
         }
      },


      deleteNode: function (settings, callback) {

         if (!settings.node.id) {
            callback(new Error('missing node id input'));

         }
         ;

         azureStorage.getNodeTagging(settings.regionContext.cloudRegion, settings.node.id, function (err, tagRetval) {

            if (err) {
               callback(err);
               return;

            }

            // execute delete node rest
            var DelSettings = {
               url: 'https://management.core.windows.net/' + settings.regionContext.subscriptionId + '/services/hostedservices/' + tagRetval.cloudService + '/deployments/' + tagRetval.deployment + '/roles/' + settings.node.id,
               xMsVersion: xMsVersion,
               azureCertPath: settings.regionContext.azureCertPath,
               azureKeyPath: settings.regionContext.azureKeyPath,
               successCode: [202, 400],
               retryCodes: [307, 409]
            };

            azureRetryDeleteRequest(DelSettings, 40, interval, function (err, delResRole) {
               if (err) {
                  callback(err);
                  return;

               }


               // response 400 means last role in the deployment
               if (delResRole === 400) {

                  var DelSettings = {
                     url: 'https://management.core.windows.net/' + settings.regionContext.subscriptionId + '/services/hostedservices/' + tagRetval.cloudService + '/deployments/' + tagRetval.deployment,
                     xMsVersion: xMsVersion,
                     azureCertPath: settings.regionContext.azureCertPath,
                     azureKeyPath: settings.regionContext.azureKeyPath,
                     successCode: [202],
                     retryCodes: [307, 409]
                  };

                  // in case of last role in deployment delete cloud service
                  azureRetryDeleteRequest(DelSettings, 40, interval, function (err, delResDeploy) {
                     if (err) {
                        callback(err);
                        return;

                     }

                     var DelSettings = {
                        url: 'https://management.core.windows.net/' + settings.regionContext.subscriptionId + '/services/hostedservices/' + tagRetval.cloudService,
                        xMsVersion: xMsVersion,
                        azureCertPath: settings.regionContext.azureCertPath,
                        azureKeyPath: settings.regionContext.azureKeyPath,
                        successCode: [200],
                        retryCodes: [307, 409]
                     };

                     // in case of last role delete deployment +cloud service
                     azureRetryDeleteRequest(DelSettings, 40, interval, function (err, delResService) {
                        if (err) {
                           callback(err);
                           return;

                        }
                        azureStorage.deleteTagging('node', settings.regionContext.cloudRegion, settings.node.id, function (err, deleteTagRetval) {

                           if (err) {
                              callback(err);
                              return;

                           }

                           callback(null, delResService);
                        });
                     });
                  });
               }

               else {

                  azureStorage.deleteTagging('node', settings.regionContext.cloudRegion, settings.node.id, function (err, deleteTagRetval) {

                     if (err) {
                        callback(err);
                        return;

                     }

                     callback(null, delResRole);
                  });


               }

               // delete node tagging


            });
         });

      },

      createImage: function (settings, callback) {
         var imageName = 'imageCreatedByStorm' + (new Date().valueOf());


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
                     url: 'https://management.core.windows.net/' + settings.regionContext.subscriptionId + '/services/hostedservices/' + tagRetval.cloudService + '/deployments/' + tagRetval.deployment + '/roleinstances/' + settings.imageParams.nodeId + '/Operations',
                     xMsVersion: xMsVersion,
                     azureCertPath: settings.regionContext.azureCertPath,
                     azureKeyPath: settings.regionContext.azureKeyPath,
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

                  azureStorage.addImageTagging(settings.regionContext.cloudRegion, imageName, settings.imageParams.tags, function (err, res) {
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

      },


      listImages: function (settings, callback) {


         var finalResults = {rawResult: {}, images: []},
            getSettings = {
               url: 'https://management.core.windows.net/' + settings.regionContext.subscriptionId + '/services/vmimages',
               xMsVersion: xMsVersion,
               azureCertPath: settings.regionContext.azureCertPath,
               azureKeyPath: settings.regionContext.azureKeyPath,
               successCode: 200
            };

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

               var status;

               azureStorage.getImageTagging(settings.regionContext.cloudRegion, imageEach.Name[0], function (err, tagRetval) {


                  if (err) {
                     errors.push(err)
                     status = 'ERROR';
                  }
                  else {
                     status = 'ACTIVE';
                  }

                  imageIndex += 1;

                  var image = {
                     id: imageEach.Name[0],
                     status: status,
                     name: imageEach.Name[0],
                     tags: tagRetval
                  };

                  finalResults.images.push(image);

                  if (imageIndex === numberOfImages) {

                     azureStorage.getImages(settings.regionContext.cloudRegion, function (error, resultImages) {

                        if (error) {
                           callback(err);
                           return;
                        }

                        margeImagesLists(resultImages, finalResults, function (err, res) {
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

         var DelSettings = {
            url: 'https://management.core.windows.net/' + settings.regionContext.subscriptionId + '/services/vmimages/' + settings.imageParams.imageId,
            xMsVersion: xMsVersion,
            azureCertPath: settings.regionContext.azureCertPath,
            azureKeyPath: settings.regionContext.azureKeyPath,
            successCode: [202],
            retryCodes: [307, 409]
         };


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

      }

   };
   return that;
})
   ();






