/*
 * The copyright in this software is being made available under the BSD License, included below. This software may be subject to other third party and contributor rights, including patent rights, and no such rights are granted under this license.
 *
 * Copyright (c) 2013, Digital Primates
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * •  Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * •  Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * •  Neither the name of the Digital Primates nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS “AS IS” AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
MediaPlayer.dependencies.AbrController = function () {
    "use strict";

    var autoSwitchBitrate = true,
        qualityDict = {},
        confidenceDict = {},

        getInternalQuality = function (type) {
            var quality;

            if (!qualityDict.hasOwnProperty(type)) {
                qualityDict[type] = 0;
            }

            quality = qualityDict[type];

            return quality;
        },

        setInternalQuality = function (type, value) {
            qualityDict[type] = value;
        },

        getInternalConfidence = function (type) {
            var confidence;

            if (!confidenceDict.hasOwnProperty(type)) {
                confidenceDict[type] = 0;
            }

            confidence = confidenceDict[type];

            return confidence;
        },

        setInternalConfidence = function (type, value) {
            confidenceDict[type] = value;
        },

        getQualityBoundaries = function (type, data) {
            var self = this,
                deferred = Q.defer(),
                qualityMin = self.config.getParamFor(type, "ABR.minQuality", "number", -1),
                qualityMax = self.config.getParamFor(type, "ABR.maxQuality", "number", -1),
                bandwidthMin = self.config.getParamFor(type, "ABR.minBandwidth", "number", -1),
                bandwidthMax = self.config.getParamFor(type, "ABR.maxBandwidth", "number", -1),
                i,
                funcs = [];

            self.debug.log("[AbrController]["+type+"] Quality   boundaries: [" + qualityMin + "," + qualityMax + "]");
            self.debug.log("[AbrController]["+type+"] Bandwidth boundaries: [" + bandwidthMin + "," + bandwidthMax + "]");

                // Get min quality corresponding to min bandwidth
                self.manifestExt.getRepresentationCount(data).then(
                    function (count) {
                        // Get bandwidth boundaries and override quality boundaries
                        if ((bandwidthMin !== -1) || (bandwidthMax !== -1)) {
                            for (i = 0; i < count; i += 1) {
                                funcs.push(self.manifestExt.getRepresentationBandwidth( data, i));
                            }
                            Q.all(funcs).then(
                                function (bandwidths) {
                                    if (bandwidthMin !== -1) {
                                        for (i = 0; i < count; i += 1) {
                                            if (bandwidths[i] >= bandwidthMin) {
                                                qualityMin = (qualityMin === -1) ? i : Math.max(i, qualityMin);
                                                break;
                                            }
                                        }
                                    }
                                    if (bandwidthMax !== -1) {
                                        for (i = (count - 1); i >= 0; i -= 1) {
                                            if (bandwidths[i] <= bandwidthMax) {
                                                qualityMax = (qualityMax === -1) ? i : Math.min(i, qualityMax);
                                                break;
                                            }
                                        }
                                    }
                                }
                            );
                        }

                        qualityMin = (qualityMin >= count) ? (count - 1) : qualityMin;
                        qualityMax = (qualityMax >= count) ? (count - 1) : qualityMax;
                        deferred.resolve({min: qualityMin, max: qualityMax});
                    }
                );

            return deferred.promise;
        };

    return {
        debug: undefined,
        abrRulesCollection: undefined,
        manifestExt: undefined,
        metricsModel: undefined,
        config: undefined,

        getAutoSwitchBitrate: function () {
            return autoSwitchBitrate;
        },

        setAutoSwitchBitrate: function (value) {
            autoSwitchBitrate = value;
        },

        getMetricsFor: function (data) {
            var deferred = Q.defer(),
                self = this;

            self.manifestExt.getIsVideo(data).then(
                function (isVideo) {
                    if (isVideo) {
                        deferred.resolve(self.metricsModel.getMetricsFor("video"));
                    } else {
                        self.manifestExt.getIsAudio(data).then(
                            function (isAudio) {
                                if (isAudio) {
                                    deferred.resolve(self.metricsModel.getMetricsFor("audio"));
                                } else {
                                    deferred.resolve(self.metricsModel.getMetricsFor("stream"));
                                }
                            }
                        );
                    }
                }
            );

            return deferred.promise;
        },

        _getPlaybackQuality: function (type, data) {
            var self = this,
                deferred = Q.defer(),
                newQuality = MediaPlayer.rules.SwitchRequest.prototype.NO_CHANGE,
                newConfidence = MediaPlayer.rules.SwitchRequest.prototype.NO_CHANGE,
                i,
                len,
                funcs = [],
                req,
                values,
                quality,
                confidence;

            quality = getInternalQuality(type);

            confidence = getInternalConfidence(type);

            //self.debug.log("ABR enabled? (" + autoSwitchBitrate + ")");

            if (autoSwitchBitrate) {
                self.debug.log("[AbrController]["+type+"] Check rules....");

                self.getMetricsFor(data).then(
                    function (metrics) {
                        self.abrRulesCollection.getRules().then(
                            function (rules) {
                                for (i = 0, len = rules.length; i < len; i += 1) {
                                    funcs.push(rules[i].checkIndex(quality, metrics, data));
                                }
                                Q.all(funcs).then(
                                    function (results) {
                                        //self.debug.log(results);
                                        values = {};
                                        values[MediaPlayer.rules.SwitchRequest.prototype.STRONG] = MediaPlayer.rules.SwitchRequest.prototype.NO_CHANGE;
                                        values[MediaPlayer.rules.SwitchRequest.prototype.WEAK] = MediaPlayer.rules.SwitchRequest.prototype.NO_CHANGE;
                                        values[MediaPlayer.rules.SwitchRequest.prototype.DEFAULT] = MediaPlayer.rules.SwitchRequest.prototype.NO_CHANGE;

                                        for (i = 0, len = results.length; i < len; i += 1) {
                                            req = results[i];
                                            self.debug.log("[AbrController]["+type+"] Request for quality " + req.quality + ", priority = " + req.priority);
                                            if (req.quality !== MediaPlayer.rules.SwitchRequest.prototype.NO_CHANGE) {
                                                values[req.priority] = Math.min(values[req.priority], req.quality);
                                            }
                                        }

                                        if (values[MediaPlayer.rules.SwitchRequest.prototype.WEAK] !== MediaPlayer.rules.SwitchRequest.prototype.NO_CHANGE) {
                                            newConfidence = MediaPlayer.rules.SwitchRequest.prototype.WEAK;
                                            newQuality = values[MediaPlayer.rules.SwitchRequest.prototype.WEAK];
                                        }

                                        if (values[MediaPlayer.rules.SwitchRequest.prototype.DEFAULT] !== MediaPlayer.rules.SwitchRequest.prototype.NO_CHANGE) {
                                            newConfidence = MediaPlayer.rules.SwitchRequest.prototype.DEFAULT;
                                            newQuality = values[MediaPlayer.rules.SwitchRequest.prototype.DEFAULT];
                                        }

                                        if (values[MediaPlayer.rules.SwitchRequest.prototype.STRONG] !== MediaPlayer.rules.SwitchRequest.prototype.NO_CHANGE) {
                                            newConfidence = MediaPlayer.rules.SwitchRequest.prototype.STRONG;
                                            newQuality = values[MediaPlayer.rules.SwitchRequest.prototype.STRONG];
                                        }

                                        if (newQuality !== MediaPlayer.rules.SwitchRequest.prototype.NO_CHANGE && newQuality !== undefined) {
                                            quality = newQuality;
                                        }

                                        if (newConfidence !== MediaPlayer.rules.SwitchRequest.prototype.NO_CHANGE && newConfidence !== undefined) {
                                            confidence = newConfidence;
                                        }

                                        self.manifestExt.getRepresentationCount(data).then(
                                            function (max) {
                                                // be sure the quality valid!
                                                if (quality < 0) {
                                                    quality = 0;
                                                }
                                                // zero based
                                                if (quality >= max) {
                                                    quality = max - 1;
                                                }

                                                if (confidence != MediaPlayer.rules.SwitchRequest.prototype.STRONG &&
                                                    confidence != MediaPlayer.rules.SwitchRequest.prototype.WEAK) {
                                                    confidence = MediaPlayer.rules.SwitchRequest.prototype.DEFAULT;
                                                }

                                                self.debug.log("[AbrController]["+type+"] Set quality: " + quality);
                                                setInternalQuality(type, quality);
                                                //self.debug.log("New quality of " + quality);

                                                setInternalConfidence(type, confidence);
                                                //self.debug.log("New confidence of " + confidence);

                                                deferred.resolve({quality: quality, confidence: confidence});
                                            }
                                        );
                                    }
                                );
                            }
                        );
                    }
                );
            } else {
                //self.debug.log("Unchanged quality of " + quality);
                deferred.resolve({quality: quality, confidence: confidence});
            }

            return deferred.promise;
        },

        getPlaybackQuality: function (type, data) {
            var self = this,
                deferred = Q.defer(),
                previousQuality = self.getQualityFor(type),
                qualityMin = -1,
                qualityMax = -1,
                quality,
                switchUpIncrementally = self.config.getParamFor(type, "ABR.switchUpIncrementally", "boolean", false);

            // Call parent's getPlaybackQuality function
            self._getPlaybackQuality(type, data).then(
                function (result) {
                    quality = result.quality;

                    if (self.getAutoSwitchBitrate()) {
                        // Check incremental switch
                        if (switchUpIncrementally && (quality > previousQuality)) {
                            self.debug.log("[AbrController]["+type+"] Incremental switch => quality: " + quality);
                            quality = previousQuality + 1;
                        }

                        // Check representation boundaries
                        getQualityBoundaries.call(self, type, data).then(
                            function (qualityBoundaries) {
                                qualityMin = qualityBoundaries.min;
                                qualityMax = qualityBoundaries.max;

                                if ((qualityMin !== -1) && (quality < qualityMin)) {
                                    quality = qualityMin;
                                    self.debug.log("[AbrController]["+type+"] New quality < min => " + quality);
                                }

                                if ((qualityMax !== -1) && (quality > qualityMax)) {
                                    quality = qualityMax;
                                    self.debug.log("[AbrController]["+type+"] New quality > max => " + quality);
                                }

                                self.setPlaybackQuality.call(self, type, quality);
                                deferred.resolve({quality: quality, confidence: result.confidence});
                            }
                        );
                    } else {
                        deferred.resolve({quality: quality, confidence: result.confidence});
                    }

                }
            );

            return deferred.promise;
        },

        setPlaybackQuality: function (type, newPlaybackQuality) {
            var quality = getInternalQuality(type);

            this.debug.log("[AbrController]["+type+"] Set playback quality: " + newPlaybackQuality);

            if (newPlaybackQuality !== quality) {
                setInternalQuality(type, newPlaybackQuality);
            }
        },

        getQualityFor: function (type) {
            return getInternalQuality(type);
        }
    };
};

MediaPlayer.dependencies.AbrController.prototype = {
    constructor: MediaPlayer.dependencies.AbrController
};
