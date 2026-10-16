import { Module } from '@nestjs/common';
import { UpstreamTester } from './upstream-tester';
import { UpstreamsController } from './upstreams.controller';
import { UpstreamsService } from './upstreams.service';

@Module({ controllers: [UpstreamsController], providers: [UpstreamsService, UpstreamTester] })
export class UpstreamsModule {}
