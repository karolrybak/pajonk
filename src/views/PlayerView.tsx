import React, { useEffect, useRef, useState } from 'react';
import { PlayerEngine } from '../core/PlayerEngine';
import { loadLevel } from '../core/LevelSystem';

interface PlayerViewProps {
    levelName: string;
}

export const PlayerView: React.FC<PlayerViewProps> = ({ levelName }) => {
    const canvasRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<PlayerEngine | null>(null);
    const [fps, setFps] = useState(0);

    useEffect(() => {
        if (!canvasRef.current) return;
        const player = new PlayerEngine(canvasRef.current);
        player.onFpsUpdate = setFps;
        player.init().then(async () => {
            if (levelName) {
                await loadLevel(levelName, player);
                player.spawnPlayer();
            }
        });
        playerRef.current = player;
        return () => player.dispose();
    }, [levelName]);

    return (
        <div style={{ width: '100%', height: '100%', position: 'relative', background: '#000' }}>
            <div ref={canvasRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }} />
            <div style={{ position: 'absolute', top: 10, left: 10, color: '#444', fontSize: 10 }}>
                FPS: {fps} | PLAYER MODE
            </div>
        </div>
    );
};