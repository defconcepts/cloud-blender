var should = require('should'),
   underscore = require('underscore'),
   compute = require('../lib/azure.js'),
   azureStorage = require('../lib/azure_storage.js'),
   imageId = 'image',
   node1,
   node2,
   image;


process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

var providerName = 'azure',
   regionAuthSettings = {cloudRegion: 'North Europe', subscriptionId: 'a2937094-60b6-4b00-966d-b4a2fcd5cb27', azureKeyPath: '/media/sf_Shared/key.pem', azureCertPath: '/media/sf_Shared/cert.pem', azureSshPemPath: '/media/sf_Shared/myCert.pem', azureFingerPrint: 'E9DA92526F8BEB7A2ECA0A66577C51661C0825E3'},
   regionLimits = {maxRolesPerService: 2};


var regionContext = compute.createRegionContext(regionAuthSettings, regionLimits);


describe('checking azure local atomic lib', function () {


   it('should create an authentication context', function () {

      var regionContext = compute.createRegionContext( regionAuthSettings, regionLimits);
      should.exist(regionContext.cloudRegion);
      should.exist(regionContext.azureCertPath);
      should.exist(regionContext.azureKeyPath);
      should.exist(regionContext.subscriptionId);
      should.exist(regionContext.limits)
      should.exist(regionContext.azureFingerPrint);
      should.exist(regionContext.azureSshPemPath);
   });
});


describe('checking azure atomic lib', function () {


   it('should launch instance on azure', function (done) {
      var regionContext = compute.createRegionContext( regionAuthSettings, regionLimits),
         settingsPrepare = {
            regionContext: regionContext,
            nodes: [
               {
                  imageId: imageId,
                  tags: {
                     jobId: 'dummyJobId',
                     env: 'test',
                     role: 'injector-Test'
                  },
                  userData: {'paramA': 'keyA', 'paramB': 'keyB', 'paramC': 'keyc'}
               },
               {
                  imageId: imageId,
                  tags: {
                     jobId: 'dummyJobId',
                     env: 'test',
                     role: 'injector-Test'
                  },
                  userData: {'paramA': 'keyA', 'paramB': 'keyB', 'paramC': 'keyc'}
               }
            ]
         },
         settingsCreate = {
            regionContext: regionContext,
            nodeParams: {
               imageId: imageId,
               tags: {
                  jobId: 'dummyJobId',
                  env: 'test',
                  role: 'injector-Test'
               },
               userData: {'paramA': 'keyA', 'paramB': 'keyB', 'paramC': 'keyc'}
            }
         };


      this.timeout(300000);

      compute.createPreparation(settingsPrepare, function (error, resultServices) {

         if (error) {
            console.log('error creating preparation-' + error);
            done();
            return;
         }

         else {


            compute.createNode(settingsCreate, resultServices, 0, function (error1, result1) {

               if (error1) {
                  console.log('error creating node1-' + error1);
                  done();
                  return;
               }

               should.not.exist(error1);
               should.exist(result1.rawResult);
               should.exist(result1.node);
               should.exist(result1.node.id);
               should.exist(result1.node.tags);
               should.exist(result1.node.tags.jobId);
               'Starting'.should.equal(result1.node.status);
               console.log('node 1 was created');
               node1 = result1.node;


               compute.createNode(settingsCreate, resultServices, 1, function (error2, result2) {

                  if (error2) {
                     console.log('error creating node1-' + error2);
                     done();
                     return;
                  }

                  should.not.exist(error2);
                  should.exist(result2.rawResult);
                  should.exist(result2.node);
                  should.exist(result2.node.id);
                  should.exist(result2.node.tags);
                  should.exist(result1.node.tags.jobId);
                  'Starting'.should.equal(result2.node.status);
                  node2 = result2.node;
                  console.log('node 2 was created');

                  done();

               });

            });
         }
         ;
      });
   });

   /*
   it('should get a list of nodes from azure in find both nodes which were created', function (done) {
      var waitInterval = 120000,
         settings = {
            regionContext: regionContext
         };

      this.timeout(200000);

      setTimeout(function () {


         compute.listNodes(settings, function (error, result) {

            if (error) {
               console.log('error get node list-' + error);
               done();
               return;
            }

            var nodeCheck1 = underscore.contains((underscore.pluck(result.nodes, 'id')), node1.id);
            var nodeCheck2 = underscore.contains((underscore.pluck(result.nodes, 'id')), node2.id);

            console.log('nodeCheck1-' + nodeCheck1);
            console.log('nodeCheck2-' + nodeCheck2);
            should.not.exist(error);
            should.exist(result);
            should.exist(result.nodes);
            should.exist(result.rawResult);
            true.should.equal(nodeCheck1);
            true.should.equal(nodeCheck2);
            done();
         });
      }, waitInterval);
   });


   it('should create image from the first node which was created', function (done) {
      var waitInterval = 2,
         settingsList = {
            regionContext: regionContext

         };
      this.timeout(260000);

      setTimeout(function () {

         var settingsImage = {
            regionContext: regionContext,
            imageParams: {
               nodeId: node1.id,
               tags: {
                  'creationDate': new Date(),
                  'createdFor': 'test purposes',
                  'logicName': 'dummy-image'
               },
               vendorSpecificParams: {
                  Description: 'blah blah blah created by a dummy test'
               }
            }
         };

         compute.createImage(settingsImage, function (error, resultImage) {

            if (error) {
               console.log('error create image-' + error);
               done();
               return;
            }


            if (resultImage) {
               console.log('image-' + resultImage.imageId + ' was created');
            }
            should.not.exist(error);
            should.exist(resultImage.imageId);
            image = resultImage.imageId;
            done()
         });
      }, waitInterval);
   });


   it('should get a list of images from azure in find the image which was created', function (done) {
      var waitInterval = 300000,
         settings = {
            regionContext: regionContext
         };

      this.timeout(360000);

      setTimeout(function () {


         compute.listImages(settings, function (error, result) {

            if (error) {
               console.log('error get  image list-' + error);
               done();
               return;
            }

            var imageCheck = underscore.contains((underscore.pluck(result.images, 'id')), image);
            should.not.exist(error);
            should.exist(result);
            should.exist(result.images);
            should.exist(result.rawResult);
            true.should.equal(imageCheck);
            done();
         });
      }, waitInterval);
   });


   it('should delete image from aws-ec2', function (done) {

      var waitInterval = 360000;

      this.timeout(420000);

      setTimeout(function () {

         var settingsDelImage = {
            regionContext: regionContext,
            imageParams: {
               imageId: image
            }
         }

         console.log('image -' + settingsDelImage.imageParams.imageId + ' will be deleted');

         if (settingsDelImage.imageParams.imageId) {
            compute.deleteImage(settingsDelImage, function (error, result) {
               if (error) {
                  console.log('error delete image-' + error);
                  done();
                  return;
               }
               should.not.exist(error);
               done();

            });
         }
      }, waitInterval);

   });


   it('should delete instance from azure', function (done) {
      var waitInterval = 360000;

      this.timeout(420000);


      setTimeout(function () {


         var
            settingsDelete2 = {
               regionContext: regionContext,
               node: node2

            };

         console.log('node -' + settingsDelete2.node.id + ' will be deleted');
         compute.deleteNode(settingsDelete2, function (error, result) {
            if (error) {
               console.log('error delete node-' + error);
               done();
               return;
            }
            should.not.exist(error);
            done();

         });


      }, waitInterval);
   });
    */
});


