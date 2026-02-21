import React from 'react';
import ReactDOM from 'react-dom/client';
import { EditorView } from './views/EditorView';
import { PlayerView } from './views/PlayerView';

const App = () => {
    const path = window.location.pathname;
    const isPlay = path.startsWith('/play/');
    const levelName = path.split('/').pop() || '';

    return (
        <div style={{ 
            position: 'fixed', 
            inset: 0, 
            color: '#eee', 
            fontFamily: 'monospace', 
            userSelect: 'none', 
            background: '#222' 
        }}>
            {isPlay ? (
                <PlayerView levelName={levelName} />
            ) : (
                <EditorView initialLevelName={levelName} />
            )}
        </div>
    );
};

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);