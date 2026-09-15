<?php

namespace App\Filament\Resources\FacilityNodes;

use App\Filament\Resources\FacilityNodes\Pages\ManageFacilityNodes;
use App\Models\FacilityNode;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Form;
use Filament\Resources\Resource;
use Filament\Tables\Actions\BulkActionGroup;
use Filament\Tables\Actions\DeleteBulkAction;
use Filament\Tables\Actions\EditAction;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;

class FacilityNodeResource extends Resource
{
    protected static ?string $model = FacilityNode::class;

    protected static ?string $recordTitleAttribute = 'name';

    public static function form(Form $form): Form
    {
        return $form->schema([
            Select::make('facility_id')->relationship('facility', 'name')->searchable()->preload(),
            Select::make('parent_id')->relationship('parent', 'name')->searchable()->preload(),
            TextInput::make('name')->required()->maxLength(255),
            TextInput::make('node_type')->maxLength(255),
            Textarea::make('description')->columnSpanFull(),
        ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('facility.name')->label('Facility')->searchable()->sortable(),
                TextColumn::make('parent.name')->label('Parent')->searchable(),
                TextColumn::make('name')->searchable()->sortable(),
                TextColumn::make('node_type')->searchable()->sortable(),
            ])
            ->actions([
                EditAction::make(),
            ])
            ->bulkActions([
                BulkActionGroup::make([
                    DeleteBulkAction::make(),
                ]),
            ]);
    }

    public static function getPages(): array
    {
        return [
            'index' => ManageFacilityNodes::route('/'),
        ];
    }
}
