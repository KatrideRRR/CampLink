
import { useEffect, useState } from 'react';
import { connectToServer } from './services/connection';
import './App.css';

function App() {
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        return connectToServer(setConnected);
    }, []);

    return (
        <main className="app">
            <header className="header">
                <div className="brand">
                    <div className="brand-icon">C</div>
                    <span>CampLink</span>
                </div>

                <span className="version">v0.1</span>
            </header>

            <section className="welcome">
                <h1>Связь без границ.</h1>
                <p>
                    Один мессенджер. Разные способы доставки.
                </p>
            </section>

            <section className="panel">
                <div className="panel-title">
                    <h2>Состояние соединения</h2>
                    <span
                        className={
                            connected
                                ? 'status online'
                                : 'status offline'
                        }
                    >
            {connected ? 'На связи' : 'Нет соединения'}
          </span>
                </div>

                <div className="channel">
                    <span>Интернет</span>
                    <span>
            {connected ? 'Подключён' : 'Недоступен'}
          </span>
                </div>

                <div className="channel">
                    <span>Электронная почта</span>
                    <span>Планируется</span>
                </div>

                <div className="channel">
                    <span>SMS</span>
                    <span>Планируется</span>
                </div>

                <div className="channel">
                    <span>Ретрансляторы</span>
                    <span>В будущем</span>
                </div>
            </section>

            <p className="footer">
                Защищённая связь — наша следующая цель.
            </p>
        </main>
    );
}

export default App;
