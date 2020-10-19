requirejs.config({
    //"baseUrl": "/",
    "paths": {
      "artifacts":       "./artifacts",

      "text":            "https://unpkg.com/requirejs-text@2.0.15/text",

      "ethers":          "https://unpkg.com/ethers@5.0.17/dist/ethers.umd",
      "react":           "https://unpkg.com/react@16/umd/react.development",
      "react-dom":       "https://unpkg.com/react-dom@16/umd/react-dom.development",
      "@portis/web3":    "https://unpkg.com/@portis/web3@2.0.0-beta.59/umd/index"
    }
});

// Load the main app module to start the app
//requirejs(["./components/CrecUniswap.js"]);

requirejs(['./components/CrecUniswap.js', 'react', 'react-dom'], (CrecUniswap, React, ReactDOM) => {
  var domContainer = document.querySelector('#crecUniswap');
 
  ReactDOM.render(React.createElement(CrecUniswap.default), domContainer);
});