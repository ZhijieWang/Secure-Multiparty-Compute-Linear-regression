(function (exports, node) {
  var saved_instance;

  /**
   * Connect to the server and initialize the jiff instance
   */
  exports.connect = function (hostname, computation_id, options) {
    var opt = Object.assign({}, options);
    opt.autoConnect = false;
    // Added options goes here

    if (node) {
      // eslint-disable-next-line no-undef
      jiff = require('./lib/jiff-client');
      // eslint-disable-next-line no-undef
      jiff_bignumber = require('./lib/ext/jiff-client-bignumber');
      // eslint-disable-next-line no-undef
      jiff_fixedpoint = require('./lib/ext/jiff-client-fixedpoint');
      // eslint-disable-next-line no-undef
      jiff_negativenumber = require('./lib/ext/jiff-client-negativenumber');
      // eslint-disable-next-line no-undef
      jiff_performance = require('./lib/ext/jiff-client-performance');
      // eslint-disable-next-line no-undef
      BigNumber = require('./bignumber.js');
      // eslint-disable-next-line no-undef,no-global-assign
      $ = require('jquery-deferred');
    }

    opt.autoConnect = false;
    // eslint-disable-next-line no-undef
    saved_instance = jiff.make_jiff(hostname, computation_id, opt);
    // eslint-disable-next-line no-undef
    saved_instance.apply_extension(jiff_bignumber, opt);
    // eslint-disable-next-line no-undef
    saved_instance.apply_extension(jiff_fixedpoint, opt);
    // eslint-disable-next-line no-undef
    saved_instance.apply_extension(jiff_negativenumber, opt);
    // eslint-disable-next-line no-undef
    saved_instance.apply_extension(jiff_performance, { elementId: 'perfDiv' });

    saved_instance.connect();
    return saved_instance;
  };

  /**
   * The MPC computation
   */
  exports.compute = function (coordinates, jiff_instance) {
    if (jiff_instance == null) {
      jiff_instance = saved_instance;
    }

    var values = [];
    for (var i = 0; i < coordinates.length; i++) {
      values.push(coordinates[i].x);
      values.push(coordinates[i].y)
    }

    var deferred = $.Deferred();
    var zero = jiff_instance.share(0, null, null, [1])[1];
    console.log(zero)
    var precision = jiff_instance.helpers.magnitude(jiff_instance.decimal_digits);

    zero = zero.cmult(precision); // increase precision

    // share input with all parties
    jiff_instance.share_array(values).then(function (inputs) {
      var xAvg = zero;
      var yAvg = zero;
      var xSqAvg = zero;
      var ySqAvg = zero;
      var xyAvg = zero;
      var length = 0;

      // Computer Avgs
      var i, j;
      for (i = 1; i <= jiff_instance.party_count; i++) {
        for (j = 0; j < inputs[i].length; j += 2) {
          xAvg = xAvg.sadd(inputs[i][j]);
          yAvg = yAvg.sadd(inputs[i][j+1]);
          // do not divide in smult, we can handle the increase precision since no two multiplications
          // are performed in sequence
          xSqAvg = xSqAvg.sadd(inputs[i][j].smult(inputs[i][j], null, false));
          ySqAvg = ySqAvg.sadd(inputs[i][j+1].smult(inputs[i][j+1], null, false));
          xyAvg = xyAvg.sadd(inputs[i][j].smult(inputs[i][j+1], null, false));
          length++;
        }
      }

      var factor = precision.times(length);
      xAvg = xAvg.cdiv(length);
      yAvg = yAvg.cdiv(length);
      xSqAvg = xSqAvg.cdiv(factor);
      ySqAvg = ySqAvg.cdiv(factor);
      xyAvg = xyAvg.cdiv(factor);

      // Compute standard deviations
      var xDevSq = zero;
      var yDevSq = zero;
      for (i = 1; i <= jiff_instance.party_count; i++) {
        for (j = 0; j < inputs[i].length; j += 2) {
          var xDiff = inputs[i][j].ssub(xAvg);
          var yDiff = inputs[i][j+1].ssub(yAvg);
          // Same reasoning, do not divide individual values to reduce precision, delay division till the end
          xDevSq = xDevSq.sadd(xDiff.smult(xDiff, null, false));
          yDevSq = yDevSq.sadd(yDiff.smult(yDiff, null, false));
        }
      }
      xDevSq = xDevSq.cdiv(factor);
      yDevSq = yDevSq.cdiv(factor);

      // Finally, compute slope (squared)
      var numerator = xyAvg.ssub(xAvg.smult(yAvg));
      numerator = numerator.smult(numerator);
      numerator = numerator.smult(yDevSq);

      var denumerator = xSqAvg.ssub(xAvg.smult(xAvg));
      denumerator = denumerator.smult(ySqAvg.ssub(yAvg.smult(yAvg)));
      denumerator = denumerator.smult(xDevSq);

      var mSq = numerator.sdiv(denumerator);
      mSq.open().then(function (mSq) {
        var m = mSq.sqrt();
        m = jiff_instance.helpers.to_fixed(m);

        var p = yAvg.cmult(precision).ssub(xAvg.cmult(m, null, false));
        p.open().then(function (p) {
          p = jiff_instance.helpers.to_fixed(p.div(precision));
          xAvg.open().then(function(xAvg){
            xAvg=jiff_instance.helpers.to_fixed(xAvg.div(precision))
            yAvg.open().then(function(yAvg){
              yAvg = jiff_instance.helpers.to_fixed(yAvg.div(precision))
              xDevSq.open().then(function(xDevSq){
                xDevSq = jiff_instance.helpers.to_fixed(xDevSq.div(precision))
                yDevSq.open().then(function(yDevSq){
                  yDevSq = jiff_instance.helpers.to_fixed(yDevSq.div(precision))
                  deferred.resolve({ x_avg: xAvg, yAvg:yAvg, xStd:xDevSq, yStd:yDevSq, a:m, b: p});
                })
              })

            })  
          })
          
        });
      });
    });


    return deferred.promise();
  };
}((typeof exports === 'undefined' ? this.mpc = {} : exports), typeof exports !== 'undefined'));
