![Antimony Logo](https://antimony-team.github.io/antimony/images/logo.svg)


# Antimony
Antimony is a platform and graphical interface to design and manage <a href="https://containerlab.dev">containerlab</a> networks.

![Antimony](https://antimony-team.github.io/antimony/images/antimony-title.png)

## ✨ Features

* **Designing Networks Easily**  
    Antimony offers a user friendly drag-and-drop interface to quickly and efficiently design containerlab networks. 
* **Side-By-Side Editor**  
    The side-by-side code editor makes direct adjustments to the topology's definition more straightforward.
* **Deployment and Management of Instances**  
    Antimony's management interfaces grants full control over all scheduled, running and inactive containerlab instances.
* **Clabernetes Support**  
    Experimental support for the [clabernetes](https://containerlab.dev/manual/clabernetes/) backend that allows deployment on [Kubernetes](https://kubernetes.io/) instances.
* **User Access Management via OpenID**  
    Antimony supports multi-user application through the OpenID provider of your choice.
* **Real-time Updates**  
    Antimony talks to containerlab and [Docker](https://www.docker.com/) and provides real-time information on containers such as deployment status, Docker stats and more!
* **Log Streaming**  
    The interface allows you to view containerlab and Docker logs in real-time. 

## 🚀 How to Run
To run Antimony locally, simply clone this repository and deploy the docker containers with docker compose.
```bash
git clone https://github.com/antimony-team/antimony
cd antimony
docker compose up
```

By default, the server is hosted on `localhost:80` and `localhost:443` and the interface can be accessed with the `admin:admin`.

For more information about the deployment please refer to Antimony's [documentation](https://antimony-team.github.io/antimony/quick-start.html).

## ⚙️ Configuration
The config file `config.yml` is mounted into the docker container and can be used to configure the Antimony server.

For more information about the contiguration please refer to Antimony's [documentation](https://antimony-team.github.io/antimony/manual/configuration.html).

## 💼 Use cases

* **Educational Environment**  
    Antimony was developed with the main goal of being a platform for teachers to teach students about networking technology. The scalable architecture and external authentication make it easy to deploy Antimony in an educational environment.
* **Personal Use and Local Deployment**  
    The interface of Antimony aims to make designing and deploying containerlab networks easy and accesible for everyone. Deploying and using Antimony locally requires little to no experience with networks or the containerlab framework.

## 🖥️ Repository Setup
Antimony is separated into three main repositories.

* **[antimony-team/antimony](https://github.com/antimony-team/antimony)**  
    Contains the documentation as well as all the deployment files.
* **[antimony-team/antimony-backend](https://github.com/antimony-team/antimony-backend)**  
    Contains the code base for the Antimony server.
* **[antimony-team/antimony-interface](https://github.com/antimony-team/antimony-interface)**  
    Contains the code base for Antimony's frontend interface.

If you encounter any issues or would like to suggest a new feature, please submit an issue to the corresponding repository.

## License

Antimony and all of its assets are distributed under the MIT license.