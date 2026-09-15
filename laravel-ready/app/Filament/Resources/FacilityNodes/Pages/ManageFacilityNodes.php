<?php

namespace App\Filament\Resources\FacilityNodes\Pages;

use App\Filament\Resources\FacilityNodes\FacilityNodeResource;
use Filament\Actions\CreateAction;
use Filament\Resources\Pages\ManageRecords;

class ManageFacilityNodes extends ManageRecords
{
    protected static string $resource = FacilityNodeResource::class;

    protected function getHeaderActions(): array
    {
        return [
            CreateAction::make(),
        ];
    }
}
