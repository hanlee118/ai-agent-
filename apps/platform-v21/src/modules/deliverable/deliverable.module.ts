import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Deliverable } from './entities/deliverable.entity';
import { DeliverableService } from './services/deliverable.service';

@Module({
  imports: [TypeOrmModule.forFeature([Deliverable])],
  providers: [DeliverableService],
  exports: [DeliverableService, TypeOrmModule],
})
export class DeliverableModule {}
