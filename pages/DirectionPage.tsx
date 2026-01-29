import React, { useEffect, useRef, useState } from 'react';
import CameraObjectDetection from '../components/CameraObjectDetection';
import { Mic, MicOff, Navigation } from 'lucide-react';
import Layout from '../components/Layout';

// Prefer env var the rest of the app already uses
const GOOGLE_MAPS_API_KEY =
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY) ||
    (typeof process !== 'undefined' && process.env?.VITE_GOOGLE_MAPS_API_KEY) ||
    '';

const DirectionPage: React.FC = () => {
    const mapRef = useRef<HTMLDivElement | null>(null);
    // Only store user-facing error messages (no dev/debug text)
    const [mapError, setMapError] = useState<string>('');
    const [destination, setDestination] = useState<string>('');
    const [isRouting, setIsRouting] = useState<boolean>(false);
    const [voiceStatus, setVoiceStatus] = useState<string>(''); // For debugging/user feedback
    const recognitionRef = useRef<any>(null);
    const mapInstanceRef = useRef<any>(null);
    const markerRef = useRef<any>(null);
    const pendingLocationRef = useRef<{ lat: number; lng: number } | null>(null);
    const originRef = useRef<{ lat: number; lng: number } | null>(null);
    const directionsServiceRef = useRef<any>(null);
    const directionsRendererRef = useRef<any>(null);

    // New state for transit info
    const [transitInfo, setTransitInfo] = useState<{
        distance: string;
        duration: string;
        lines: string[];
    } | null>(null);

    // Track the latest transcript to handle cases where onend fires before isFinal
    const latestTranscriptRef = useRef<string>('');
    const processingRef = useRef<boolean>(false);

    // Voice automation on mount
    useEffect(() => {
        // Simple check to see if API exists at all
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            // setMapError("Voice input not supported in this browser."); // Silent fail if not supported
            return;
        }

        const timer = setTimeout(() => {
            const synth = window.speechSynthesis;
            if (!synth) {
                // If no TTS, just try starting mic
                startVoiceInput();
                return;
            }

            // Cancel any previous speaking
            synth.cancel();

            const utterance = new SpeechSynthesisUtterance("Where would you like to go?");
            utterance.onend = () => {
                startVoiceInput();
            };
            utterance.onerror = (e) => {
                // console.error("TTS Error:", e); // Fallback to start mic anyway
                startVoiceInput();
            };

            // This might fail if user hasn't interacted yet. 
            // We catch that by just logging; the user can manually click mic later.
            try {
                synth.speak(utterance);
            } catch (err) {
                // console.warn("Autoplay blocked or TTS failed", err); // ignore
            }
        }, 800);

        return () => {
            clearTimeout(timer);
            if (recognitionRef.current) {
                recognitionRef.current.stop();
            }
        };
    }, []);

    const startVoiceInput = () => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setVoiceStatus("Voice API not supported.");
            return;
        }

        if (voiceStatus.includes("Listening")) return; // Prevent starting if already listening

        // Reset tracking refs
        latestTranscriptRef.current = '';
        processingRef.current = false;
        setVoiceStatus("Requesting microphone...");

        try {
            const recognition = new SpeechRecognition();
            recognitionRef.current = recognition;

            recognition.lang = 'en-US';
            recognition.interimResults = true;
            recognition.maxAlternatives = 1;
            // We want it to stop automatically after silence, so continuous=false is correct
            recognition.continuous = false;

            recognition.onstart = () => {
                setVoiceStatus("Listening... Speak now.");
                setDestination(""); // Clear input on new voice session
                setMapError('');
            };

            recognition.onend = () => {
                // Check if we have a transcript that hasn't been processed
                if (!processingRef.current && latestTranscriptRef.current.trim()) {
                    const final = latestTranscriptRef.current.trim();
                    console.log('Voice session ended with text:', final);
                    setVoiceStatus("Processing...");
                    processingRef.current = true;
                    setDestination(final); // Ensure final text is set
                    handleGetDirections(final);
                } else if (!processingRef.current) {
                    setVoiceStatus("Stopped (No speech detected).");
                } else {
                    // Already processed
                    setVoiceStatus("Stopped.");
                }
            };

            recognition.onresult = (event: any) => {
                if (processingRef.current) return;

                let interim = '';
                let final = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    const result = event.results[i];
                    if (result.isFinal) {
                        final += result[0].transcript;
                    } else {
                        interim += result[0].transcript;
                    }
                }

                // If final result, process immediately
                if (final) {
                    let clean = final.trim();
                    if (clean.endsWith('.')) clean = clean.slice(0, -1);

                    latestTranscriptRef.current = clean;
                    setDestination(clean);

                    console.log('Final voice result:', clean);
                    setVoiceStatus(`Heard: "${clean}"`);

                    processingRef.current = true;
                    handleGetDirections(clean);
                    stopVoiceInput();
                }
                // If interim, just update UI and ref
                else if (interim) {
                    latestTranscriptRef.current = interim;
                    setDestination(interim);
                    setVoiceStatus("Listening...");
                }
            };

            recognition.onerror = (event: any) => {
                console.error('Speech recognition error', event.error);
                if (event.error === 'not-allowed') {
                    setVoiceStatus("Mic permission denied.");
                    setMapError('Microphone permission denied. Please check browser settings.');
                } else if (event.error === 'no-speech') {
                    setVoiceStatus("No speech detected.");
                } else {
                    setVoiceStatus(`Error: ${event.error}`);
                }
            };

            recognition.start();
        } catch (e) {
            console.error('Failed to start recognition', e);
            setVoiceStatus("Failed to start speech engine.");
        }
    };

    const stopVoiceInput = () => {
        if (recognitionRef.current) {
            recognitionRef.current.stop();
        }
    };

    useEffect(() => {
        if (!GOOGLE_MAPS_API_KEY) {
            console.error('Missing VITE_GOOGLE_MAPS_API_KEY');
            setMapError('Map configuration error. Please contact support.');
            return;
        }

        // If script is already on the page, reuse it
        const existingScript = document.querySelector<HTMLScriptElement>('script[data-map-loader="google"]');
        if (existingScript && (window as any).google) {
            initMap();
            return;
        }

        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=geometry`;
        script.async = true;
        script.defer = true;
        script.dataset.mapLoader = 'google';
        script.onload = initMap;
        script.onerror = () => {
            console.error('Failed to load Google Maps script');
            setMapError('Unable to load the map right now. Please check your connection and try again.');
        };
        document.head.appendChild(script);

        return () => {
            // Keep script cached; just remove map instance on unmount
        };
    }, []);

    const initMap = () => {
        if (!mapRef.current || !(window as any).google?.maps) return;

        // Default center (Chennai) until we get real device location
        const defaultLocation = { lat: 13.0827, lng: 80.2707 };

        const map = new (window as any).google.maps.Map(mapRef.current, {
            zoom: 12,
            center: defaultLocation,
        });

        mapInstanceRef.current = map;
        directionsServiceRef.current = new (window as any).google.maps.DirectionsService();
        directionsRendererRef.current = new (window as any).google.maps.DirectionsRenderer({
            map,
            suppressMarkers: false,
        });

        // If we already have a pending device location, apply it now
        if (pendingLocationRef.current) {
            const loc = pendingLocationRef.current;
            map.setCenter(loc);
            map.setZoom(15);
            markerRef.current = new (window as any).google.maps.Marker({
                position: loc,
                map,
            });
            pendingLocationRef.current = null;
        }

        // No UI message needed when map loads successfully
    };

    // Request device location as soon as the page loads
    useEffect(() => {
        if (!('geolocation' in navigator)) {
            setMapError('Location is not supported on this device/browser.');
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const loc = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                };

                // Store origin for routing
                originRef.current = loc;

                // If map is ready, center it on the device; otherwise store for later
                if ((window as any).google?.maps && mapInstanceRef.current) {
                    mapInstanceRef.current.setCenter(loc);
                    mapInstanceRef.current.setZoom(15);

                    if (markerRef.current) {
                        markerRef.current.setMap(null);
                    }
                    markerRef.current = new (window as any).google.maps.Marker({
                        position: loc,
                        map: mapInstanceRef.current,
                    });
                } else {
                    pendingLocationRef.current = loc;
                }

                // No UI message needed when location works
            },
            (error) => {
                console.error('Geolocation error:', error);
                if (error.code === 1) {
                    setMapError('Location permission denied. Please enable it to center the map on your position.');
                } else if (error.code === 2) {
                    setMapError('Location unavailable. Check your GPS or network and try again.');
                } else if (error.code === 3) {
                    setMapError('Getting your location timed out. Please try again.');
                } else {
                    setMapError('Unable to get your location.');
                }
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
    }, []);

    // Geocode destination first, then request directions (more reliable errors)
    const handleGetDirections = (destinationOverride?: string) => {
        const destToUse = typeof destinationOverride === 'string' ? destinationOverride : destination;

        if (!destToUse.trim()) {
            setMapError('Please enter a destination.');
            return;
        }
        setMapError('');

        const googleAny = (window as any);
        if (!googleAny.google?.maps || !directionsServiceRef.current || !directionsRendererRef.current) {
            setMapError('Map is not ready yet. Please wait a moment and try again.');
            return;
        }

        // Check for location
        if (!originRef.current) {
            setMapError('Reading your current location... Please wait.');
            // Try fetching again immediately
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const loc = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                    };
                    originRef.current = loc;
                    setMapError(''); // Clear "reading..."

                    // Now proceed recursively once
                    handleGetDirections(destToUse);
                },
                (err) => {
                    console.error("Retry location failed", err);
                    setMapError('Could not get your location. Please ensure GPS is enabled and allowed.');
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
            return;
        }

        const origin = originRef.current;
        const destText = destToUse.trim();

        setIsRouting(true);

        const geocoder = new googleAny.google.maps.Geocoder();
        geocoder.geocode({ address: destText }, (geoResults: any, geoStatus: string) => {
            if (geoStatus !== 'OK' || !geoResults || !geoResults[0]) {
                setIsRouting(false);
                console.error('Geocode failed:', geoStatus, geoResults);
                if (geoStatus === 'ZERO_RESULTS' || geoStatus === 'NOT_FOUND') {
                    setMapError('Destination not found. Try a full address or nearby landmark.');
                } else {
                    setMapError(`Unable to find that place (${geoStatus}). Please try again.`);
                }
                return;
            }

            const destinationLocation = geoResults[0].geometry.location;
            const destinationAddress = geoResults[0].formatted_address;

            // Calculate distance in meters using Geometry library
            let distanceMeters = 0;
            if (googleAny.google.maps.geometry && googleAny.google.maps.geometry.spherical) {
                const originLatLng = new googleAny.google.maps.LatLng(origin.lat, origin.lng);
                distanceMeters = googleAny.google.maps.geometry.spherical.computeDistanceBetween(
                    originLatLng,
                    destinationLocation
                );
            } else {
                console.warn("Geometry library not loaded, assuming short distance");
            }

            console.log(`Distance is ~${distanceMeters.toFixed(0)} meters`);

            // Logic: > 1km (1000m) -> Transit, else Walking
            const travelMode = distanceMeters > 1000
                ? googleAny.google.maps.TravelMode.TRANSIT
                : googleAny.google.maps.TravelMode.WALKING;

            // Step 2: Request directions
            directionsServiceRef.current.route(
                {
                    origin,
                    destination: destinationAddress,
                    travelMode: travelMode,
                    provideRouteAlternatives: true,
                },
                (result: any, status: string) => {
                    setIsRouting(false);
                    if (status === 'OK' && result) {
                        directionsRendererRef.current.setDirections(result);

                        // Extract details
                        const leg = result.routes[0].legs[0];
                        const distText = leg.distance.text;
                        const durText = leg.duration.text;

                        const lines: string[] = [];
                        if (travelMode === googleAny.google.maps.TravelMode.TRANSIT) {
                            // Parse steps for transit lines
                            leg.steps.forEach((step: any) => {
                                if (step.travel_mode === 'TRANSIT' && step.transit) {
                                    const lineName = step.transit.line.short_name || step.transit.line.name;
                                    const vehicle = step.transit.line.vehicle?.name || 'Bus';
                                    if (lineName) {
                                        lines.push(`${vehicle} ${lineName}`);
                                    }
                                }
                            });
                        }

                        setTransitInfo({
                            distance: distText,
                            duration: durText,
                            lines: lines.length > 0 ? lines : (distanceMeters > 1000 ? ['No direct transit lines found'] : [])
                        });

                        // Announce route details via voice
                        const synth = window.speechSynthesis;
                        if (synth) {
                            synth.cancel();
                            let speechText = '';
                            if (lines.length > 0) {
                                const linesText = lines.join(', ');
                                speechText = `Found a route. It takes ${durText}. You can take ${linesText}.`;
                            } else if (distanceMeters <= 1000) {
                                speechText = `It is a short walk of ${distText}. It will take about ${durText}.`;
                            } else {
                                speechText = `Route found. Distance is ${distText}, taking ${durText}.`;
                            }

                            const utterance = new SpeechSynthesisUtterance(speechText);
                            utterance.rate = 1.0;
                            synth.speak(utterance);
                        }

                        // Clear previous marker if any, Directions API will show markers
                        if (markerRef.current) {
                            markerRef.current.setMap(null);
                            markerRef.current = null;
                        }
                    } else {
                        setTransitInfo(null);
                        console.error('Directions request failed with status:', status, result);
                        if (status === 'ZERO_RESULTS') {
                            setMapError('No route found. Try a nearby landmark or different mode.');
                        } else if (status === 'NOT_FOUND') {
                            setMapError('Destination not found. Try a full address or well-known place.');
                        } else if (status === 'REQUEST_DENIED') {
                            setMapError('Request denied. Check API key referrer and billing settings.');
                        } else if (status === 'OVER_QUERY_LIMIT') {
                            setMapError('Query limit reached. Try again later.');
                        } else {
                            setMapError(`Unable to calculate route. (${status}) Please try again with a nearby landmark or full address.`);
                        }
                    }
                }
            );
        });
    };

    return (
        <Layout>
            <div className="w-full h-[calc(100vh-80px)] p-4 md:p-6 lg:p-8 flex flex-col md:flex-row gap-6">

                {/* Left Column: Controls & Info */}
                <div className="w-full md:w-1/3 flex flex-col gap-6 overflow-y-auto">
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <h1 className="text-3xl font-bold text-white">Directions</h1>
                            <div className="text-xs text-white/60">
                                {originRef.current
                                    ? <span className="text-emerald-400 flex items-center gap-1">● GPX Connected</span>
                                    : <span className="text-amber-400 flex items-center gap-1 animate-pulse">● Locating you...</span>
                                }
                            </div>
                        </div>
                        <p className="text-white/60 text-sm">Use voice or text to find your way.</p>
                    </div>

                    <div className="flex flex-col gap-3">
                        <div className="relative w-full">
                            <input
                                type="text"
                                value={destination}
                                onChange={(e) => setDestination(e.target.value)}
                                placeholder={voiceStatus.includes("Listening") ? "Listening... (Speak now)" : "Enter your destination"}
                                className={`w-full rounded-xl bg-black/40 border px-4 py-3 pr-12 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors ${voiceStatus.includes("Listening") ? 'border-amber-400/50 ring-1 ring-amber-400/20' : 'border-white/10'
                                    }`}
                            />
                            <button
                                type="button"
                                onClick={voiceStatus.includes("Listening") ? stopVoiceInput : startVoiceInput}
                                className={`absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full transition-colors ${voiceStatus.includes("Listening")
                                    ? 'bg-amber-500 text-white animate-pulse'
                                    : 'text-white/50 hover:text-white hover:bg-white/10'
                                    }`}
                                title={voiceStatus.includes("Listening") ? "Stop listening" : "Start voice input"}
                            >
                                {voiceStatus.includes("Listening") ? <MicOff size={18} /> : <Mic size={18} />}
                            </button>
                        </div>

                        {voiceStatus && (
                            <p className={`text-xs px-1 font-medium ${voiceStatus.includes("Error") || voiceStatus.includes("denied")
                                ? "text-red-400"
                                : "text-amber-200/90"
                                }`}>
                                {voiceStatus}
                            </p>
                        )}

                        <button
                            onClick={() => handleGetDirections()}
                            disabled={isRouting}
                            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
                        >
                            {isRouting ? (
                                <>Finding route...</>
                            ) : (
                                <>
                                    <Navigation size={18} />
                                    Get Directions
                                </>
                            )}
                        </button>
                    </div>

                    {mapError && (
                        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm">
                            {mapError}
                        </div>
                    )}

                    {transitInfo && (
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 animate-in slide-in-from-left-4 backdrop-blur-sm">
                            <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-4">
                                <div>
                                    <h2 className="text-white font-semibold text-lg">Route Details</h2>
                                    <p className="text-xs text-white/50">Estimated travel time</p>
                                </div>
                                <div className="text-right">
                                    <span className="block text-2xl font-bold text-white">{transitInfo.duration}</span>
                                    <span className="text-xs bg-white/10 px-2 py-0.5 rounded text-white/80">{transitInfo.distance}</span>
                                </div>
                            </div>

                            {transitInfo.lines.length > 0 ? (
                                <div className="space-y-3">
                                    <p className="text-xs text-indigo-300 uppercase tracking-wide font-bold">Public Transport Needed</p>
                                    <div className="flex flex-wrap gap-2">
                                        {transitInfo.lines.map((line, idx) => (
                                            <div key={idx} className="flex items-center gap-2 bg-indigo-500/20 border border-indigo-500/30 px-3 py-1.5 rounded-lg">
                                                <span className="w-2 h-2 rounded-full bg-indigo-400"></span>
                                                <span className="text-indigo-100 text-sm font-medium">{line}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-start gap-3 bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20">
                                    <div className="bg-emerald-500/20 p-2 rounded-lg">
                                        <Navigation className="w-4 h-4 text-emerald-400" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-emerald-200">Short Distance</p>
                                        <p className="text-xs text-emerald-200/60 mt-0.5">
                                            Destination is under 1km. A walking route has been plotted on the map.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Show Camera if Walking (No transit lines) */}
                            {transitInfo.lines.length === 0 && (
                                <CameraObjectDetection />
                            )}
                        </div>
                    )}
                </div>

                {/* Right Column: Map */}
                <div className="w-full md:w-2/3 h-[500px] md:h-full bg-white/5 rounded-3xl overflow-hidden border border-white/10 shadow-2xl relative">
                    <div
                        ref={mapRef}
                        id="map"
                        className="w-full h-full"
                    />
                </div>
            </div>
        </Layout>
    );
};

export default DirectionPage;
