import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { io } from 'socket.io-client';
import '@xterm/xterm/css/xterm.css';
import { Play } from 'lucide-react';
import { API_BASE, apiFetch } from '../config';

export default function TerminalTab({ task }) {
  const terminalRef = useRef(null);
  const [socket, setSocket] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [workingDirectory, setWorkingDirectory] = useState('C:\\');
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);

  useEffect(() => {
    let term;
    let fitAddon;
    let resizeListener;

    // Fetch global working directory
    apiFetch(`${API_BASE}/api/settings`)
      .then(res => res.json())
      .then(data => {
        if (data.workingDirectory) {
           setWorkingDirectory(data.workingDirectory);
        }
      })
      .catch(err => console.error('Failed to fetch settings:', err));

    // Initialize Xterm with a tiny delay to ensure DOM is ready
    const timer = setTimeout(() => {
      term = new Terminal({
        theme: {
          background: '#1e1e1e',
          foreground: '#d4d4d4',
          cursor: '#fff',
          selection: 'rgba(255, 255, 255, 0.3)'
        },
        fontFamily: 'Consolas, "Courier New", monospace',
        fontSize: 13,
        cursorBlink: true
      });
      
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      
      if (terminalRef.current) {
        term.open(terminalRef.current);
        fitAddon.fit();
      }

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      resizeListener = () => {
        if (fitAddonRef.current && xtermRef.current) {
          try {
            fitAddonRef.current.fit();
          } catch(e) {}
        }
      };
      
      window.addEventListener('resize', resizeListener);
    }, 50);

    return () => {
      clearTimeout(timer);
      if (resizeListener) window.removeEventListener('resize', resizeListener);
      if (term) term.dispose();
    };
  }, []);

  useEffect(() => {
    const handleResizeEmit = () => {
       if (socket && xtermRef.current) {
         socket.emit('resize', { 
            cols: xtermRef.current.cols, 
            rows: xtermRef.current.rows 
         });
       }
    };
    window.addEventListener('resize', handleResizeEmit);
    return () => {
       window.removeEventListener('resize', handleResizeEmit);
    };
  }, [socket]);

  useEffect(() => {
    return () => {
      if (socket) socket.disconnect();
    };
  }, [socket]);

  const handleStartAgent = (e) => {
    e.preventDefault();
    if (socket) {
      socket.disconnect();
    }

    const newSocket = io(API_BASE);
    setSocket(newSocket);
    setIsRunning(true);

    xtermRef.current.clear();
    xtermRef.current.writeln('\x1b[36mConnecting to terminal...\x1b[0m');

    newSocket.on('connect', () => {
      xtermRef.current.writeln('\x1b[32mConnected!\x1b[0m');
      
      const safeTitle = task.title.replace(/"/g, '\\"');
      const promptText = `opencode "Please review task ${task.id}: ${safeTitle}. Check the Atrium task markdown file for details."`;
      
      newSocket.emit('start_terminal', {
        cwd: workingDirectory,
        cols: xtermRef.current.cols,
        rows: xtermRef.current.rows,
        command: promptText
      });
    });

    newSocket.on('terminal_output', (data) => {
      xtermRef.current.write(data);
    });

    xtermRef.current.onData((data) => {
      newSocket.emit('terminal_input', data);
    });

    newSocket.on('terminal_exit', () => {
      setIsRunning(false);
    });

    newSocket.on('disconnect', () => {
      xtermRef.current.writeln('\r\n\x1b[31mTerminal disconnected.\x1b[0m');
      setIsRunning(false);
    });
  };

  return (
    <div className="absolute inset-0 flex flex-col bg-black rounded-b-xl overflow-hidden shadow-inner">
      <div className="flex justify-between items-center px-4 py-2 bg-app-card border-b border-app-border shrink-0">
        <div className="flex items-center gap-2">
           <span className="text-xs font-mono text-app-text-muted">Agent Terminal</span>
        </div>
        <button
          onClick={handleStartAgent}
          className="flex items-center gap-1.5 px-3 py-1 bg-app-accent hover:bg-app-accent-hover text-white text-xs font-semibold rounded-lg transition-colors"
        >
          <Play className="w-3.5 h-3.5" />
          {isRunning ? 'Restart Agent' : 'Start Agent'}
        </button>
      </div>
      <div className="flex-1 p-2 bg-[#1e1e1e] relative">
        <div ref={terminalRef} className="absolute inset-2 overflow-hidden" />
      </div>
    </div>
  );
}