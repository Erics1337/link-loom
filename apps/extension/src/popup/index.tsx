import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../App';

const root = ReactDOM.createRoot(document.getElementById('root')!);

root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);

if (import.meta.hot) {
    // Full reload avoids stale hook state when Fast Refresh can't safely preserve popup state.
    import.meta.hot.accept(() => {
        window.location.reload();
    });
}
