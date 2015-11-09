var should = require('should'),
   underscore = require('underscore'),
   compute = require('../lib/azure_v2.js'),
   azureConfig = require('../examples/azure_v2.json');


process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

compute.setProxy('http://web-proxy.isr.hp.com:8080');

var providerName = 'azure_v2',
   regionAuthSettings = azureConfig,
   regionLimits = {};


var regionContext = compute.createRegionContext(regionAuthSettings, regionLimits);


describe('checking azure local atomic lib', function () {


   it('should create an authentication context', function () {

      var regionContext = compute.createRegionContext(regionAuthSettings, regionLimits);
      should.exist(regionContext.cloudRegion);
      should.exist(regionContext.providerName);
      should.exist(regionContext.groupId);
      should.exist(regionContext.tenantId);
      should.exist(regionContext.clientId);
      should.exist(regionContext.secret);
   });
});

describe('checking azure atomic lib', function () {

   it('should launch instance on azure', function (done) {
      var regionContext = compute.createRegionContext( regionAuthSettings, regionLimits),

         settingsCreate = {
            regionContext: regionContext,
            nodeParams: {
               imageId: 'VM5_img-osDisk.d550bcbc-9a2c-4c15-941c-41afaf9c1ad7.vhd',
               instanceType: 'Standard_A0',
               tags: {
                  jobId: 'dummyJobId',
                  env: 'test',
                  role: 'injector-Test'
               },
               userData: {'paramA': 'keyA', 'paramB': 'keyB', 'paramC': 'keyc'}
            }
         };


      this.timeout(300000);

            compute.createNode(settingsCreate, null, 0, function (error1, result1) {

               if (error1) {
                  console.log('error creating node1-' + error1);
                  done();
                  return;
               }


               should.not.exist(error1);
               done();


            });
         });
      });

