import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props={children:ReactNode};
type State={error:Error|null};

export class AppErrorBoundary extends Component<Props,State>{
  state:State={error:null};

  static getDerivedStateFromError(error:Error):State{
    return {error};
  }

  componentDidCatch(error:Error,info:ErrorInfo){
    console.error('Error no controlado en ZENVIA Gestión',error,info);
  }

  private reload=()=>window.location.reload();

  render(){
    if(!this.state.error)return this.props.children;
    return <div className="authPage">
      <div className="authPanel accessDeniedPanel">
        <h1>No se pudo mostrar la aplicación</h1>
        <p>Se ha producido un error de interfaz. Tus datos no se han borrado.</p>
        <div className="globalError">{this.state.error.message||'Error desconocido'}</div>
        <div className="actions"><button className="primary" onClick={this.reload}>Recargar</button></div>
      </div>
    </div>;
  }
}
