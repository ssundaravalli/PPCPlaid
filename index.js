'use strict';

var util = require('util');

var envvar = require('envvar');
var express = require('express');
var bodyParser = require('body-parser');
var moment = require('moment');
var plaid = require('plaid');
var httpunch = require('httpunch');


var APP_PORT = envvar.number('APP_PORT', 8000);
var PLAID_CLIENT_ID = '5e91014bc2c21f001155807c'; 
var PLAID_SECRET = '2198a573bb96c08efd0c3dd3e9c774'; 
var PLAID_PUBLIC_KEY = 'f8fbe722d649bae624cc17be65acea' 
var PLAID_ENV = envvar.string('PLAID_ENV', 'sandbox');
// PLAID_PRODUCTS is a comma-separated list of products to use when initializing
// Link. Note that this list must contain 'assets' in order for the app to be
// able to create and retrieve asset reports.
var PLAID_PRODUCTS = envvar.string('PLAID_PRODUCTS', 'sba_verification');

// PLAID_PRODUCTS is a comma-separated list of countries for which users
// will be able to select institutions from.
var PLAID_COUNTRY_CODES = envvar.string('PLAID_COUNTRY_CODES', 'US,CA,GB,FR,ES,IE,NL');

// Parameters used for the OAuth redirect Link flow.
//
// Set PLAID_OAUTH_REDIRECT_URI to 'http://localhost:8000/oauth-response.html'
// The OAuth redirect flow requires an endpoint on the developer's website
// that the bank website should redirect to. You will need to whitelist
// this redirect URI for your client ID through the Plaid developer dashboard
// at https://dashboard.plaid.com/team/api.
var PLAID_OAUTH_REDIRECT_URI = envvar.string('PLAID_OAUTH_REDIRECT_URI', '');
// Set PLAID_OAUTH_NONCE to a unique identifier such as a UUID for each Link
// session. The nonce will be used to re-open Link upon completion of the OAuth
// redirect. The nonce must be at least 16 characters long.
var PLAID_OAUTH_NONCE = envvar.string('PLAID_OAUTH_NONCE', '');

// We store the access_token in memory - in production, store it in a secure
// persistent data store
var ACCESS_TOKEN = null;
var PUBLIC_TOKEN = null;
var ITEM_ID = null;
// The payment_token is only relevant for the UK Payment Initiation product.
// We store the payment_token in memory - in production, store it in a secure
// persistent data store
var PAYMENT_TOKEN = null;
var PAYMENT_ID = null;

// Initialize the Plaid client
// Find your API keys in the Dashboard (https://dashboard.plaid.com/account/keys)
var client = new plaid.Client(
  PLAID_CLIENT_ID,
  PLAID_SECRET,
  PLAID_PUBLIC_KEY,
  plaid.environments[PLAID_ENV],
  {version: '2019-05-29', clientApp: 'Paypal Plaid Integration'}
);

var app = express();
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({
  extended: false
}));
app.use(bodyParser.json());

app.get('/', function(request, response, next) {
  console.log("Access token : "+ACCESS_TOKEN);
  response.render('index.ejs', {
    PLAID_PUBLIC_KEY: PLAID_PUBLIC_KEY,
    PLAID_ENV: PLAID_ENV,
    PLAID_PRODUCTS: PLAID_PRODUCTS,
    PLAID_COUNTRY_CODES: PLAID_COUNTRY_CODES,
    PLAID_OAUTH_REDIRECT_URI: PLAID_OAUTH_REDIRECT_URI,
    PLAID_OAUTH_NONCE: PLAID_OAUTH_NONCE,
    ITEM_ID: ITEM_ID,
    ACCESS_TOKEN: ACCESS_TOKEN,
  });
  console.log("Access token : "+ACCESS_TOKEN);
});

// This is an endpoint defined for the OAuth flow to redirect to.
app.get('/oauth-response.html', function(request, response, next) {
  response.render('oauth-response.ejs', {
    PLAID_PUBLIC_KEY: PLAID_PUBLIC_KEY,
    PLAID_ENV: PLAID_ENV,
    PLAID_PRODUCTS: PLAID_PRODUCTS,
    PLAID_COUNTRY_CODES: PLAID_COUNTRY_CODES,
    PLAID_OAUTH_NONCE: PLAID_OAUTH_NONCE,
  });
});

// Exchange token flow - exchange a Link public_token for
// an API access_token
// https://plaid.com/docs/#exchange-token-flow
app.post('/get_access_token', function(request, response, next) {
  PUBLIC_TOKEN = request.body.public_token;
  console.log("Access token : "+ACCESS_TOKEN);
  client.exchangePublicToken(PUBLIC_TOKEN, function(error, tokenResponse) {
    if (error != null) {
      prettyPrintResponse(error);
      return response.json({
        error: error,
      });
    }
    ACCESS_TOKEN = tokenResponse.access_token;
    ITEM_ID = tokenResponse.item_id;
    prettyPrintResponse(tokenResponse);
    response.json({
      access_token: ACCESS_TOKEN,
      item_id: ITEM_ID,
      error: null,
    });
  });
});



// Retrieve ACH or ETF Auth data for an Item's accounts
// https://plaid.com/docs/#auth
app.get('/sba', function(request, response, next) {
  console.log("SBA Access token : "+ACCESS_TOKEN);
  var payload = {
	client_id: PLAID_CLIENT_ID, 
	secret: PLAID_SECRET,
	access_token: ACCESS_TOKEN 
  };
  var opts = {
        protocol: 'https:',
        hostname: 'sandbox.plaid.com',
        method: 'POST',
        path: `/sba/verification/get`,
        headers: {
            'Content-Type': 'application/json',
            'accept': 'application/json'
        },
        body: JSON.stringify(payload),
        rejectUnauthorized: false
    }; 
  makeApiRequest('post', opts, function(error, authResponse) {
    if (error != null) {
      console.log("SBA response not error");
      prettyPrintResponse(error);
      return response.json({
        error: error,
      });
    }
    prettyPrintResponse(authResponse);

    response.json({ error: null, auth: JSON.stringify(authResponse)}); });
});

const makeApiRequest = (method, opts, callback) => {
    console.log('****** Method name :'+ method);
    httpunch.request(opts, (err, data) => {
        console.log('*********** Http Unch Callback'+JSON.stringify(opts));
        if (err) {
            console.log('*********** Http Unch Error');
            return callback(err);
        }

        try {
            const body = JSON.parse(data.body);
            return callback(null, body);
        } catch (err) {
            console.log('*********** Http Unch eception'+JSON.stringify(err));
            return callback(null);
        }
    });

};
var server = app.listen(process.env.PORT || 3000, function() {
  console.log('plaid-quickstart server listening on port ' + APP_PORT);
});

var prettyPrintResponse = response => {
  console.log(util.inspect(response, {colors: true, depth: 4}));
};

// This is a helper function to poll for the completion of an Asset Report and
// then send it in the response to the client. Alternatively, you can provide a
// webhook in the `options` object in your `/asset_report/create` request to be
// notified when the Asset Report is finished being generated.
var respondWithAssetReport = (
  numRetriesRemaining,
  assetReportToken,
  client,
  response
) => {
  if (numRetriesRemaining == 0) {
    return response.json({
      error: 'Timed out when polling for Asset Report',
    });
  }

  var includeInsights = false;
  client.getAssetReport(
    assetReportToken,
    includeInsights,
    function(error, assetReportGetResponse) {
      if (error != null) {
        prettyPrintResponse(error);
        if (error.error_code == 'PRODUCT_NOT_READY') {
          setTimeout(
            () => respondWithAssetReport(
              --numRetriesRemaining, assetReportToken, client, response),
            1000
          );
          return
        }

        return response.json({
          error: error,
        });
      }

      client.getAssetReportPdf(
        assetReportToken,
        function(error, assetReportGetPdfResponse) {
          if (error != null) {
            return response.json({
              error: error,
            });
          }

          response.json({
            error: null,
            json: assetReportGetResponse.report,
            pdf: assetReportGetPdfResponse.buffer.toString('base64'),
          })
        }
      );
    }
  );
};

app.post('/set_access_token', function(request, response, next) {
  ACCESS_TOKEN = request.body.access_token;
  client.getItem(ACCESS_TOKEN, function(error, itemResponse) {
    response.json({
      item_id: itemResponse.item.item_id,
      error: false,
    });
  });
});

// This functionality is only relevant for the UK Payment Initiation product.
// Sets the payment token in memory on the server side. We generate a new
// payment token so that the developer is not required to supply one.
// This makes the quickstart easier to use.
app.post('/set_payment_token', function(request, response, next) {
  client.createPaymentRecipient(
    'Harry Potter',
    'GB33BUKB20201555555555',
    {street: ['4 Privet Drive'], city: 'Little Whinging', postal_code: '11111', country: 'GB'},
  ).then(function(createPaymentRecipientResponse) {
    let recipientId = createPaymentRecipientResponse.recipient_id;

    return client.createPayment(
      recipientId,
      'payment_ref',
      {currency: 'GBP', value: 12.34},
    ).then(function(createPaymentResponse) {
      let paymentId = createPaymentResponse.payment_id;

      return client.createPaymentToken(
        paymentId,
      ).then(function(createPaymentTokenResponse) {
        let paymentToken = createPaymentTokenResponse.payment_token;
        PAYMENT_TOKEN = paymentToken;
        PAYMENT_ID = paymentId;
        return response.json({error: null, paymentToken: paymentToken});
      })
    })
  }).catch(function(error) {
    prettyPrintResponse(error);
    return response.json({ error: error });
  });

});
