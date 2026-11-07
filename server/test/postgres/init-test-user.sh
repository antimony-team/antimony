#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 <<-EOSQL
	CREATE USER antimony WITH ENCRYPTED PASSWORD 'password123';
	CREATE DATABASE antimony OWNER antimony;
EOSQL
