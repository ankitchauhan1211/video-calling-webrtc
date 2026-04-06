"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { socket } from "@/lib/signalingClient";
import { acquireLocalMedia, hasSecureMediaContext } from "@/lib/getUserMedia";
import { applyOutgoingVideoEncoding, optimizeLocalVideoTracks } from "@/lib/webrtcEncoding";
import styles from "../styles/FirstPage.module.css";

const FirstPage = () => {
  const [username, setUsername] = useState("");
  const [currentUser, setCurrentUser] = useState("");
  const [callTo, setCallTo] = useState("");

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const ringtoneRef = useRef(null);
  const ringtoneRef2 = useRef(null);

  const pcRef = useRef(null);
  const currentUserRef = useRef("");
  const remotePeerRef = useRef("");
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const remoteFullscreenTargetRef = useRef(null);

  const [localStream, setLocalStream] = useState(null);
  const [isAudio, setIsAudio] = useState(true);
  const [isVideo, setIsVideo] = useState(true);
  const [inCall, setInCall] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [status, setStatus] = useState({ type: "idle", text: "" });
  const [incomingFrom, setIncomingFrom] = useState(null);
  const [outgoingRing, setOutgoingRing] = useState(false);
  const [hasLocalVideo, setHasLocalVideo] = useState(true);
  const [cameraNeedsHttps, setCameraNeedsHttps] = useState(false);
  /** WhatsApp-style full-screen call UI while in an active call */
  const [callFullscreen, setCallFullscreen] = useState(true);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    setCameraNeedsHttps(typeof window !== "undefined" && !hasSecureMediaContext());
  }, []);

  const setInfo = useCallback((text) => {
    setStatus({ type: "info", text });
  }, []);

  const setErr = useCallback((text) => {
    setStatus({ type: "error", text });
  }, []);

  const clearStatusSoon = useCallback((ms = 4000) => {
    setTimeout(() => setStatus({ type: "idle", text: "" }), ms);
  }, []);

  const handleRegister = (e) => {
    e.preventDefault();
    if (!username.trim()) {
      setErr("Enter a username.");
      return;
    }
    socket.emit("register", username.trim());
    setCurrentUser(username.trim());
    setRegistered(true);
    setInfo(`Registered as ${username.trim()}`);
    clearStatusSoon();
  };

  const stopOutgoingRing = () => {
    setOutgoingRing(false);
    const el = ringtoneRef2.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
  };

  const stopIncomingRing = () => {
    const el = ringtoneRef.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
  };

  const cleanupMedia = useCallback(() => {
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }
    setHasLocalVideo(true);
    remoteStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  }, []);

  const closePeer = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
  }, []);

  const handleHangUp = useCallback(() => {
    const peer = remotePeerRef.current;
    const self = currentUserRef.current;
    closePeer();
    cleanupMedia();
    stopOutgoingRing();
    stopIncomingRing();
    if (peer && self) {
      socket.emit("hangUp", { from: self, to: peer });
    }
    setInCall(false);
    setIncomingFrom(null);
    remotePeerRef.current = "";
    setInfo("Call ended");
    clearStatusSoon();
  }, [closePeer, cleanupMedia, clearStatusSoon, setInfo]);

  const initLocalStream = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;
    try {
      const { stream, usedVideo } = await acquireLocalMedia();
      optimizeLocalVideoTracks(stream);
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setLocalStream(stream);
      setHasLocalVideo(usedVideo);
      if (!usedVideo) {
        setInfo("Connected with audio only (no camera).");
        clearStatusSoon(6000);
      }
      return stream;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Camera/mic unavailable.";
      setErr(msg);
      throw e;
    }
  }, [setErr, setInfo, clearStatusSoon]);

  const handleCall = async (e) => {
    e.preventDefault();
    if (!registered || !currentUser) {
      setErr("Register first.");
      return;
    }
    const to = callTo.trim();
    if (!to) {
      setErr("Enter username to call.");
      return;
    }
    try {
      await initLocalStream();
    } catch {
      return;
    }
    remotePeerRef.current = to;
    setOutgoingRing(true);
    ringtoneRef2.current?.play().catch(() => {});
    socket.emit("callUser", { from: currentUser, to });
    setInCall(true);
    setCallFullscreen(true);
    setInfo(`Calling ${to}…`);
  };

  const createPeerConnection = useCallback(
    (otherUser) => {
      closePeer();
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pcRef.current = pc;
      remotePeerRef.current = otherUser;

      pc.onicecandidate = (event) => {
        if (event.candidate && currentUserRef.current) {
          socket.emit("iceCandidate", {
            to: otherUser,
            from: currentUserRef.current,
            candidate: event.candidate,
          });
        }
      };

      pc.ontrack = (event) => {
        const stream = event.streams[0];
        if (!stream) return;
        remoteStreamRef.current = stream;
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
        }
      };

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === "connected" || s === "completed") {
          setInfo("Connected");
          clearStatusSoon();
        } else if (s === "failed" || s === "disconnected") {
          setErr("Connection lost.");
        }
      };

      return pc;
    },
    [closePeer, setInfo, setErr, clearStatusSoon]
  );

  const startCallAsCaller = useCallback(
    async (otherUser) => {
      const stream = await initLocalStream();
      const pc = createPeerConnection(otherUser);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await applyOutgoingVideoEncoding(pc);
      socket.emit("offer", {
        to: otherUser,
        from: currentUserRef.current,
        offer,
      });
      setInCall(true);
      setCallFullscreen(true);
      stopOutgoingRing();
      stopIncomingRing();
    },
    [initLocalStream, createPeerConnection]
  );

  const acceptIncoming = async () => {
    if (!incomingFrom) return;
    const from = incomingFrom;
    const self = currentUserRef.current;
    try {
      await initLocalStream();
    } catch {
      return;
    }
    setIncomingFrom(null);
    stopIncomingRing();
    socket.emit("acceptCall", { from, to: self });
    remotePeerRef.current = from;
    setInfo("Connecting…");
  };

  const declineIncoming = () => {
    if (!incomingFrom) return;
    socket.emit("declineCall", { from: incomingFrom, to: currentUserRef.current });
    setIncomingFrom(null);
    stopIncomingRing();
  };

  useEffect(() => {
    const onIncomingCall = ({ from }) => {
      setIncomingFrom(from);
      ringtoneRef.current?.play().catch(() => {});
    };

    const onCallAccepted = ({ to }) => {
      void startCallAsCaller(to);
    };

    const onCallDeclined = ({ to }) => {
      setErr(`${to} declined the call`);
      stopOutgoingRing();
      setInCall(false);
      remotePeerRef.current = "";
      clearStatusSoon(5000);
    };

    const onOffer = async ({ from, offer }) => {
      try {
        const stream = await initLocalStream();
        const pc = createPeerConnection(from);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await applyOutgoingVideoEncoding(pc);
        socket.emit("answer", {
          to: from,
          from: currentUserRef.current,
          answer,
        });
        setInCall(true);
        setCallFullscreen(true);
        stopOutgoingRing();
        stopIncomingRing();
      } catch (e) {
        setErr("Could not answer call.");
        closePeer();
        cleanupMedia();
      }
    };

    const onAnswer = async ({ from, answer }) => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      } catch {
        setErr("Failed to set remote answer.");
      }
    };

    const onIceCandidate = async ({ candidate }) => {
      const pc = pcRef.current;
      if (!pc || !candidate) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        /* ignore late candidates */
      }
    };

    const onHangUp = ({ from }) => {
      setInfo(`${from} ended the call`);
      closePeer();
      cleanupMedia();
      setInCall(false);
      remotePeerRef.current = "";
      stopOutgoingRing();
      stopIncomingRing();
      clearStatusSoon();
    };

    socket.on("incomingCall", onIncomingCall);
    socket.on("callAccepted", onCallAccepted);
    socket.on("callDeclined", onCallDeclined);
    socket.on("offer", onOffer);
    socket.on("answer", onAnswer);
    socket.on("iceCandidate", onIceCandidate);
    socket.on("hangUp", onHangUp);

    return () => {
      socket.off("incomingCall", onIncomingCall);
      socket.off("callAccepted", onCallAccepted);
      socket.off("callDeclined", onCallDeclined);
      socket.off("offer", onOffer);
      socket.off("answer", onAnswer);
      socket.off("iceCandidate", onIceCandidate);
      socket.off("hangUp", onHangUp);
    };
  }, [
    cleanupMedia,
    closePeer,
    clearStatusSoon,
    setErr,
    setInfo,
    initLocalStream,
    createPeerConnection,
    startCallAsCaller,
  ]);

  useEffect(() => {
    return () => {
      closePeer();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [closePeer]);

  useLayoutEffect(() => {
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
    if (remoteVideoRef.current && remoteStreamRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
    }
  }, [inCall, callFullscreen, localStream]);

  useEffect(() => {
    if (!inCall || !callFullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [inCall, callFullscreen]);

  const toggleRemoteBrowserFullscreen = useCallback(() => {
    const v = remoteVideoRef.current;
    const wrap = remoteFullscreenTargetRef.current;
    const el = wrap ?? v;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (typeof req === "function") void req.call(el);
    }
  }, []);

  const showFullscreenCall = inCall && callFullscreen;
  const showInlineVideoCard = !inCall || !callFullscreen;

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <h1 className={styles.brand}>WebRTC Call</h1>
          <p className={styles.tagline}>Register, call by username, video chat</p>
        </header>

        {cameraNeedsHttps && (
          <div className={styles.bannerError} role="status">
            Camera/mic only work on <strong>HTTPS</strong> or <strong>localhost</strong>. If you opened this page as{" "}
            <code className={styles.inlineCode}>http://192.168…</code>, use an HTTPS tunnel (ngrok, etc.) or deploy with
            SSL.
          </div>
        )}

        {status.text && (
          <div
            className={
              status.type === "error"
                ? styles.bannerError
                : status.type === "info"
                  ? styles.bannerInfo
                  : styles.banner
            }
            role="status"
          >
            {status.text}
          </div>
        )}

        {incomingFrom && (
          <div className={styles.incomingCard} role="dialog" aria-labelledby="incoming-title">
            <p id="incoming-title" className={styles.incomingTitle}>
              Incoming call
            </p>
            <p className={styles.incomingFrom}>
              <strong>{incomingFrom}</strong>
            </p>
            <div className={styles.incomingActions}>
              <button type="button" className={styles.btnAccept} onClick={() => void acceptIncoming()}>
                Accept
              </button>
              <button type="button" className={styles.btnDecline} onClick={declineIncoming}>
                Decline
              </button>
            </div>
          </div>
        )}

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Register</h2>
          <form onSubmit={handleRegister} className={styles.form}>
            <input
              type="text"
              placeholder="Your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className={styles.input}
              autoComplete="username"
            />
            <button type="submit" className={styles.buttonPrimary} disabled={registered}>
              {registered ? "Registered" : "Register"}
            </button>
          </form>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Call</h2>
          <form onSubmit={handleCall} className={styles.form}>
            <input
              type="text"
              placeholder="Username to call"
              value={callTo}
              onChange={(e) => setCallTo(e.target.value)}
              required
              className={styles.input}
              disabled={!registered}
            />
            <button type="submit" className={styles.buttonPrimary} disabled={!registered || outgoingRing}>
              Call
            </button>
          </form>
        </section>

        {showInlineVideoCard && (
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Video</h2>
            {inCall && !callFullscreen && (
              <p className={styles.compactHint}>
                <button type="button" className={styles.linkExpand} onClick={() => setCallFullscreen(true)}>
                  Full screen
                </button>
                {" · "}
                WhatsApp-style layout
              </p>
            )}
            <div className={styles.videoWrapper}>
              <div className={styles.videoBox}>
                <span className={styles.videoLabel}>You</span>
                <video ref={localVideoRef} autoPlay playsInline muted className={styles.video} />
              </div>
              <div className={styles.videoBox}>
                <span className={styles.videoLabel}>Remote</span>
                <video ref={remoteVideoRef} autoPlay playsInline className={styles.video} />
              </div>
            </div>

            {localStream && (
              <div className={styles.controls}>
                <button
                  type="button"
                  className={styles.controlsButton}
                  onClick={() => {
                    const next = !isAudio;
                    setIsAudio(next);
                    const t = localStream.getAudioTracks()[0];
                    if (t) t.enabled = next;
                  }}
                >
                  {isAudio ? "Mute" : "Unmute"}
                </button>
                {hasLocalVideo && (
                  <button
                    type="button"
                    className={styles.controlsButton}
                    onClick={() => {
                      const next = !isVideo;
                      setIsVideo(next);
                      const t = localStream.getVideoTracks()[0];
                      if (t) t.enabled = next;
                    }}
                  >
                    {isVideo ? "Hide video" : "Show video"}
                  </button>
                )}
                {inCall && (
                  <button type="button" className={styles.hangupButton} onClick={handleHangUp}>
                    End call
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {showFullscreenCall && (
          <div className={styles.callOverlay}>
            <div className={styles.overlayTop}>
              <button
                type="button"
                className={styles.overlayTopBtn}
                onClick={() => setCallFullscreen(false)}
                aria-label="Minimize call"
              >
                Minimize
              </button>
              <button
                type="button"
                className={styles.overlayTopBtn}
                onClick={toggleRemoteBrowserFullscreen}
                aria-label="Browser full screen"
              >
                Full screen
              </button>
            </div>

            <div className={styles.callStage}>
              <div
                ref={remoteFullscreenTargetRef}
                className={styles.remoteFullArea}
                onDoubleClick={toggleRemoteBrowserFullscreen}
              >
                <video ref={remoteVideoRef} autoPlay playsInline className={styles.remoteFullVideo} />
              </div>
              {hasLocalVideo && (
                <div className={styles.pipWrap}>
                  <video ref={localVideoRef} autoPlay playsInline muted className={styles.pipVideo} />
                </div>
              )}
              <p className={styles.overlayHint}>Double-tap remote video for fullscreen</p>
            </div>

            {localStream && (
              <div className={styles.overlayBottom}>
                <button
                  type="button"
                  className={styles.overlayRoundBtn}
                  onClick={() => {
                    const next = !isAudio;
                    setIsAudio(next);
                    const t = localStream.getAudioTracks()[0];
                    if (t) t.enabled = next;
                  }}
                  aria-label={isAudio ? "Mute" : "Unmute"}
                >
                  {isAudio ? "Mute" : "Unmute"}
                </button>
                {hasLocalVideo && (
                  <button
                    type="button"
                    className={styles.overlayRoundBtn}
                    onClick={() => {
                      const next = !isVideo;
                      setIsVideo(next);
                      const t = localStream.getVideoTracks()[0];
                      if (t) t.enabled = next;
                    }}
                    aria-label={isVideo ? "Video off" : "Video on"}
                  >
                    {isVideo ? "Cam off" : "Cam on"}
                  </button>
                )}
                <button type="button" className={styles.overlayHangup} onClick={handleHangUp} aria-label="End call">
                  End
                </button>
              </div>
            )}
          </div>
        )}

        <audio ref={ringtoneRef} src="/ringtone.mp3" loop preload="auto" />
        <audio ref={ringtoneRef2} src="/Phonering.mp3" loop preload="auto" />
      </div>
    </div>
  );
};

export default FirstPage;
