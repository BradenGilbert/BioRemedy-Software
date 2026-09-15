<?php

namespace App\Filament\Resources\WorkOrders;

use App\Filament\Resources\WorkOrders\Pages\ManageWorkOrders;
use App\Models\WorkOrder;
use Filament\Forms\Components\DateTimePicker;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Form;
use Filament\Resources\Resource;
use Filament\Tables\Actions\BulkActionGroup;
use Filament\Tables\Actions\DeleteBulkAction;
use Filament\Tables\Actions\EditAction;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

class WorkOrderResource extends Resource
{
    protected static ?string $model = WorkOrder::class;

    protected static ?string $recordTitleAttribute = 'name';

    public static function form(Form $form): Form
    {
        return $form->schema([
            Select::make('project_id')->relationship('project', 'name')->searchable()->preload(),
            TextInput::make('name')->maxLength(255),
            TextInput::make('status')->default('pending')->maxLength(255),
            TextInput::make('sequence')->numeric(),
            DateTimePicker::make('start_date'),
            DateTimePicker::make('end_date'),
        ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('project.name')->label('Project')->searchable()->sortable(),
                TextColumn::make('name')->searchable()->sortable(),
                TextColumn::make('status')->badge()->sortable(),
                TextColumn::make('sequence')->sortable(),
                TextColumn::make('start_date')->dateTime()->sortable(),
                TextColumn::make('end_date')->dateTime()->sortable(),
            ])
            ->filters([
                SelectFilter::make('status'),
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
            'index' => ManageWorkOrders::route('/'),
        ];
    }
}
